# PWA manifest + Playwright smoke test — design

Date: 2026-07-17. Status: approved for planning.

## Purpose

Complete ROADMAP Phase 1's final unchecked item ("PWA manifest & installability; Playwright smoke test"), which also closes the long-standing dev-login QA gap: every live-QA session to date has hand-bootstrapped a session cookie because `/login` cannot process the implicit-flow magic links that `admin.generateLink` emits. After this slice, Phase 1 is complete.

## Decisions made during brainstorming

- **E2E auth: fix `/login` and drive the real link.** The Playwright setup generates a genuine dev magic link (admin API) and the test literally visits it, exercising the real session-establishment flow. Rejected: codifying the hand-written-cookie workaround as a fixture (leaves the login surface untested and the KNOWN_LIMITATIONS gap open); doing both (extra infra without a second consumer yet).
- **Smoke scope: one core journey** — login → onboarding with demo data → dashboard → `/score` → `/accounts` → sign out, at mobile viewport, with a zero-console-errors assertion. Rejected: broader feature spot-checks (more flake surface; can grow later) and a minimal render check (would have missed the onboarding/empty-state bugs found this week).
- **PWA scope: manifest + icons only, no service worker.** Installability on modern Chrome/Android and iOS add-to-home-screen doesn't require one, and offline caching of financial data is a privacy design question this slice must not decide silently. Matches ROADMAP's wording.
- **Icons: generated "PFI" monogram** in the positive-green token on the app background `#0b0d0f`, plus a maskable variant. Consistent with the provisional-branding rule; regenerated when the product is renamed (which needs design attention anyway). Rejected: inventing a glyph mark (undecided branding); waiting on supplied assets (blocks the slice).

## Architecture

### Manifest (`src/app/manifest.ts`, new)

Next App Router `MetadataRoute.Manifest` file convention — served at `/manifest.webmanifest` and auto-linked from every page. All naming/description fields read from `src/lib/config/branding.ts`; nothing hard-codes the product name. Fields: `name` (productFullName-based `appTitle`), `short_name` (productName), `description`, `start_url: "/"`, `display: "standalone"`, `background_color: "#0b0d0f"`, `theme_color: "#0b0d0f"` (matches the existing `viewport.themeColor`), and `icons` covering 192/512 `any` plus 512 `maskable`.

`src/app/layout.tsx` metadata gains `icons` (including `apple` for iOS add-to-home-screen). No other layout changes.

### Icons (`public/icons/`, new; no new dependencies)

- `icon.svg` — committed source: "PFI" monogram, positive-green on `#0b0d0f`, with a header comment documenting how to regenerate the PNGs (any svg→png rasterizer; done once during implementation, e.g. via the local headless browser).
- `icon-192.png`, `icon-512.png` — direct rasterizations.
- `icon-maskable-512.png` — same mark inside the maskable safe zone (mark occupies the central ~60%, background fills the full canvas).
- All PNGs committed. Deliberately no `sharp`-style native devDependency for a rarely-run generation task.

### `/login` implicit-flow session fix (`src/app/login/LoginForm.tsx`)

On mount, a `useEffect` inspects `location.hash`:
- `access_token` + `refresh_token` present → create the browser client, `await supabase.auth.setSession({ access_token, refresh_token })`, clear the hash, `router.replace("/")` on success. (`createBrowserClient` defaults to PKCE flow, which ignores hash-fragment tokens — hence the explicit `setSession`; the `@supabase/ssr` storage adapter writes the cookies the server client reads.)
- `error_description` present in the hash → surface through the existing inline error element (same copy pattern as the current `?error=` param handling).
- No hash → nothing happens; the form renders as today.

Production PKCE links (`?code=` → `/auth/callback`) are untouched. A "Signing you in…" status line renders while `setSession` is in flight (the form hides), so the flow has visible feedback and the smoke test has a deterministic state to await.

### Playwright infrastructure (new)

- `@playwright/test` devDependency (+ `pnpm exec playwright install chromium` documented as the one-time browser install).
- `playwright.config.ts`: `testDir: "e2e"`, one Chromium project at viewport 390×844, `baseURL` on a dedicated port (3100) with `webServer: { command: "pnpm dev --port 3100", url: "http://localhost:3100/login", reuseExistingServer: false }` so a developer's :3000 server never collides.
- `e2e/global-setup.ts`: loads `.env.local` (same pattern as `vitest.live.config.ts`), uses the service-role admin API to create a unique throwaway user (`e2e-<timestamp>@example.com`), calls `generateLink({ type: "magiclink" })` for its `hashed_token`, exchanges that server-side via GoTrue's `/auth/v1/verify` REST endpoint for real `access_token`/`refresh_token` values, and writes `{ email, userId, loginUrl }` to a git-ignored `e2e/.state.json`, where `loginUrl` is `<baseURL>/login#access_token=…&refresh_token=…` — the exact URL shape an implicit-flow magic link lands on. (Visiting GoTrue's own action link directly would bounce through its redirect allowlist, which is pinned to localhost:3000 in `supabase/config.toml`; constructing the hash URL sidesteps that infra constraint while still exercising the product's entire hash-processing session flow, which is the code this slice adds.)
- `e2e/global-teardown.ts`: deletes the test user via the admin API (removes all rows via existing FK cascades).
- `package.json`: `"test:e2e": "playwright test"`. **Not** added to `pnpm check` — live-DB dependent and slow, same standing as `test:rls`/`test:live`. `.gitignore` gains Playwright artifacts (`test-results/`, `playwright-report/`, `e2e/.state.json`).

### Smoke specs (`e2e/`)

- `smoke.spec.ts` — the core journey, serially, in one browser context:
  1. Visit the magic link → expect the "Signing you in…" state → land on `/onboarding` authenticated.
  2. Complete onboarding step 1 (company/ticker/username) and step 2 (cohort selects; "Load sample data" left checked) → land on `/` with dashboard content: company name, a Personal Index value, and a PFI Score visible.
  3. `/score` → overall score and at least one dimension row render.
  4. `/accounts` → the Demo data card shows "Koa Holdings" with the Active marker.
  5. Sign out → back on `/login`.
  Throughout: a `console` listener collects `error`-type messages; the test asserts the collection is empty at the end.
- `manifest.spec.ts` — fetch `/manifest.webmanifest`: valid JSON; `name`/`short_name` match `branding.ts` values; `display === "standalone"`; icons include 192 and 512 sizes with a maskable entry; each icon URL responds 200.

## Error handling

- Global setup fails fast with a clear message when `.env.local`/service key is missing (matching `test:rls`'s behavior).
- Teardown runs even on test failure (Playwright's globalTeardown semantics); a leaked user from a crashed run is identifiable by the `e2e-` email prefix.
- The `/login` fix surfaces `setSession` failures through the existing error UI — never a silent dead end.

## Testing

- Unit: no new unit-test surface (manifest is declarative config; LoginForm's hash handling is browser-integration behavior covered by the e2e spec — consistent with the codebase's convention of not unit-testing thin browser-glue).
- E2E: the two specs above are the deliverable; `pnpm test:e2e` green against the live linked project is the acceptance bar.
- `pnpm check` stays green (245/245 unit tests unchanged); `pnpm test:rls` re-run (no schema change — expected 19/19).
- Live browser verification of the manifest (fetch + parse in a real browser) and of the `/login` hash flow (visit a generated link manually via the browse tool) before the slice completes, plus a desktop-width sanity pass per CLAUDE.md.

## Docs

- `docs/DECISIONS.md` #22: e2e auth approach (real-link flow over cookie fixture), no-service-worker decision with the privacy reasoning, no-CI note (follow-up when CI exists).
- `docs/ROADMAP.md`: check off the final Phase 1 item and mark **Phase 1 complete** (all items ✅).
- `docs/KNOWN_LIMITATIONS.md`: remove "No PWA manifest yet", "No Playwright yet; browser verification is manual/screenshot-based", and the `dev-login.ts` implicit-flow entry (all resolved); add one entry: no service worker/offline support (deliberate; privacy design pass required before caching financial data), and note e2e runs only locally until CI exists.
- `docs/CURRENT_PHASE.md`: updated at slice end; "Next three priorities" drops the PWA/Playwright item.

## Out of scope

Service worker / offline caching; CI pipeline (none exists — e2e stays a local script like `test:rls`); production SMTP/deliverability verification (separate known blocker); broader e2e coverage (import flow, profile switching — natural follow-ups once the harness exists); real (non-provisional) app branding.
