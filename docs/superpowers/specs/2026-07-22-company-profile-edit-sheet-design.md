# Company Profile edit sheet — design spec

_Date: 2026-07-22 · Status: approved for planning · Slice: Company identity editing (out-of-roadmap, user-requested)_

## Summary

Make the company identity block in the dashboard's top-left (`CompanyHeader`)
tappable, opening a **bottom sheet** where the owner can edit their **company
name**, **ticker**, **username**, and choose a **company emblem** from a curated
set of built-in icon presets. The chosen emblem renders in the header (and,
later, anywhere the company's fictional identity appears).

Custom image **upload** is explicitly **deferred** to the future rankings slice
(see Deferred / Known limitations) — an uploaded logo's whole purpose is to be
seen by other users in rankings, and that cross-user surface does not exist yet.
Shipping presets-only now keeps this slice free of a storage bucket, RLS, image
resizing, and content moderation, while still delivering editable identity + a
non-default emblem.

## Why this is consistent with the product rules

- **Privacy by design is upheld, not bent.** The company's *fictional identity*
  (name, ticker, and now an emblem) is exactly what public surfaces are allowed
  to show; only raw financial data stays private. An emblem next to `$KOAH` is
  the identity layer working as intended.
- **Presets carry no PII and need no moderation** — they are curated icons, not
  user-supplied images. The moderation surface only appears when custom uploads
  become visible to others, which is deferred with rankings.
- **Deterministic code calculates; this is pure UI/identity CRUD** — no financial
  formula is touched.

## Data model — no schema change

`personal_companies.logo_path` already exists (migration `0001_core.sql`) and is
currently unused. It becomes a single **tagged string**:

| `logo_path` value        | Meaning                                             |
| ------------------------ | --------------------------------------------------- |
| `preset:<id>`            | A built-in emblem preset, e.g. `preset:palm`        |
| `null`                   | Default emblem (the current `TreePalm` treatment)   |
| `upload:<uid>/<file>`    | **Reserved** for the future custom-upload slice; not written by this slice |

Name and ticker stay on `personal_companies`; username stays on
`user_profiles`. **No migration is required for this slice.**

## Components & files

### New — `src/lib/config/company-presets.ts` (framework-light config)

A curated registry of emblem presets. A preset is an id + label + a lucide icon
component, rendered in the same circular emblem treatment `CompanyHeader`
already uses for `TreePalm`:

```ts
export interface CompanyPreset {
  id: string;              // stable, kebab-case; persisted as `preset:<id>`
  label: string;           // for the picker's accessible name
  Icon: LucideIcon;
}
export const COMPANY_PRESETS: readonly CompanyPreset[] = [ /* ~8–10 */ ];
```

Theme fits the demo companies (island / ocean): palm, waves, mountain, anchor,
sun, ship, sailboat, sunrise, etc. No image assets — icons are theme-aware and
zero-storage.

### New — pure resolver `resolveEmblem(logoPath)` (in the presets config or a sibling)

The single branching point that turns a stored `logo_path` into a render
instruction, kept pure so it is unit-testable without React and extensible for
the future upload kind:

```ts
type Emblem =
  | { kind: "preset"; preset: CompanyPreset }
  | { kind: "default" };
  // future: | { kind: "upload"; url: string }
export function resolveEmblem(logoPath: string | null): Emblem;
```

Unknown / malformed `preset:<id>` (e.g. a preset later removed) falls back to
`{ kind: "default" }` rather than throwing.

### New — `src/components/dashboard/CompanyEmblem.tsx`

Presentational. Takes `logoPath` (and later a signed `logoUrl`) and renders the
resolved emblem inside the existing circular treatment. Used by `CompanyHeader`
and by the preset picker's "currently selected" swatch.

### New — validation `src/lib/validation/company-profile.ts`

Extract the three shared identity fields out of `onboardingSchema` into shared
field schemas so onboarding and profile-edit **cannot drift**:

```ts
export const companyNameField = z.string().trim().min(2).max(40);
export const tickerField = z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "2–5 letters");
export const usernameField = z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers, underscores");
```

`onboardingSchema` is refactored to consume these (no behavior change).
`companyProfileSchema` = `{ companyName, ticker, username, logoPath }` where
`logoPath` is `z.string().regex(/^preset:[a-z0-9-]+$/).nullable()`.

### New — server action `src/app/actions/company-profile.ts`

```ts
export async function updateCompanyProfile(values: CompanyProfileValues): Promise<{ error?: string }>
```

1. `getUser()` auth guard (`{ error: "Not authenticated" }` if absent).
2. `companyProfileSchema.safeParse` → first issue message on failure.
3. Validate `logoPath` against the known preset ids (reject an unknown preset).
4. Update `user_profiles.username`; map Postgres `23505` → `"That username is taken."`.
5. Update `personal_companies` `name`, `ticker` (stored as `$` + ticker, matching
   onboarding), `logo_path`.
6. `revalidatePath("/")`.

Follows the existing `completeOnboarding` action's error-handling shape.

### New — `src/components/dashboard/CompanyProfileSheet.tsx`

A client component wrapping the reusable `src/components/ui/Sheet.tsx`
(bottom-sheet on mobile, centered dialog ≥sm, focus-trapped, Escape-closable),
modeled on `TransactionSheet` / `AccountSheet`:

- `react-hook-form` + `zodResolver(companyProfileSchema)`.
- Fields: company name, ticker (uppercase), username — reusing the onboarding
  input/label styling.
- **Emblem picker**: a grid of preset swatches (each a `CompanyEmblem`
  preview), single-select, keyboard-navigable, with the current selection
  marked by shape + `aria-pressed`/checkmark (never color alone).
- Save / Cancel. On successful save → close sheet; server `revalidatePath`
  refreshes the header. Server error shown inline via `role="alert"`.
- Seeded with the current `companyName` / `ticker` / `username` / `logoPath`.

### Changed — `src/components/dashboard/CompanyHeader.tsx`

- The identity block (`companyName` / `ticker` / `username`) becomes a
  `<button>` with `aria-label="Edit company profile"`, keyboard-focusable, that
  opens `CompanyProfileSheet`. The level badge stays outside the button.
- The static `TreePalm` span is replaced by `<CompanyEmblem logoPath={...} />`.
- New props: `logoPath` and the current profile values needed to seed the sheet.

### Changed — data plumbing

- `CompanyRow` in `src/lib/data/queries.ts` gains `logo_path: string | null`
  (`getCompany` already does `select("*")`, so no query change — just the type).
- `src/app/page.tsx` passes `logoPath` (and the seed values) into
  `HomeDashboard` → `CompanyHeader`, for both the populated dashboard and the
  `EmptyDashboard` header instance.

## UX requirements (per project rules)

- **Mobile-first:** designed and verified at ~390px first, then desktop. The
  `Sheet` primitive already handles the responsive bottom-sheet↔dialog switch.
- **Accessible:** the header trigger and every preset swatch are keyboard
  operable with visible focus; selection state is conveyed by shape/checkmark +
  text, **not color alone**; the sheet traps focus and restores it on close
  (provided by `Sheet`).
- **States:** the sheet handles submitting (disabled Save + "Saving…") and
  server-error states; empty/loading are not applicable (identity always
  exists once onboarded).
- The picker copy stays neutral (no shame/hype language).

## Testing

Per the codebase convention (no `*.test.tsx`; React verified via typecheck +
visual QA), unit tests cover the framework-free pieces:

- `company-presets` registry integrity — non-empty, unique kebab-case ids,
  every preset has a label + icon.
- `resolveEmblem` — `preset:<known>` → preset; `preset:<unknown>` → default;
  `null` → default; malformed → default.
- `companyProfileSchema` — accepts valid identity + `preset:*` / `null`
  `logoPath`; rejects bad ticker, bad username, unknown-shaped `logoPath`; and
  the shared field schemas still satisfy `onboardingSchema`'s existing tests.

Manual: `pnpm check` green; visual QA of the header trigger + sheet + preset
selection at 390px and desktop; confirm a name/ticker/username/emblem change
persists and re-renders the header; confirm a duplicate username surfaces the
"taken" message.

## Deferred / Known limitations (record in `docs/KNOWN_LIMITATIONS.md`)

The **custom company-image upload** is deferred to the rankings slice and lands
together as one unit, because an uploaded logo only becomes meaningful when
other users can see it:

- New **public-read** `company-logos` Supabase Storage bucket (writes
  owner-scoped via RLS, mirroring `0013`'s policy shape but with public reads,
  since other users render logos in rankings), 2 MB limit, `image/png|jpeg|webp`.
- Client-side resize-to-square (≤512px, canvas → webp) before upload to
  `<uid>/logo-<ts>.webp`; `logo_path` written as `upload:<path>`; `resolveEmblem`
  gains its `upload` kind and `CompanyEmblem` renders an `<img>`.
- The picker gains an explicit **"this image is public"** label (e.g. "others
  may see it next to your ticker in rankings") so no one uploads a private photo
  assuming privacy.
- **Content moderation / report mechanism** for user-supplied images, since they
  become visible to others.

Out of scope entirely (YAGNI): image cropper, multi-image gallery, animated
emblems.

## Decision to record (`docs/DECISIONS.md`)

Company identity gains an editable emblem via a bottom sheet. Emblem stored in
the existing `personal_companies.logo_path` as a tagged string
(`preset:<id>` | `null`, with `upload:<path>` reserved). Presets are curated
icons (no storage); custom upload + public bucket + moderation are deferred to
the rankings slice. Rationale: deliver editable identity + non-default emblem
immediately with zero storage/moderation surface, since an uploaded logo's value
(visibility to others) does not exist until rankings ships.
