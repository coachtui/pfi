# Password Auth Design — Login, Sign-up, Reset, and Consent

**Date:** 2026-07-19
**Status:** Approved (brainstorm with Tui, 2026-07-19)
**Replaces:** magic-link-only sign-in (the deferred auth-UX gap)

## Summary

Replace magic-link-only auth with password-based auth. Users sign in with
**email or username** plus a password. New `/signup`, `/auth/reset`, `/terms`,
and `/privacy` routes. Consent to Terms of Service and Privacy Policy is
captured at sign-up with versioned proof records, and a post-login consent
gate catches existing accounts and future document revisions. Magic links are
removed from the UI; email links remain under the hood for verification and
password reset only.

Phone sign-in was considered and deliberately deferred (needs an SMS
provider); the design adds it later without rework. Every account keeps a
verified email underneath regardless of how the user signs in.

## User-visible surfaces

### /login (rebuilt)
- One identifier field labeled "Email or username".
- Password field with show/hide toggle (open/closed eye).
- "Forgot password?" link → `/auth/reset`.
- Submit button; "New here? Create account" link → `/signup`.
- Quiet Terms / Privacy links at the bottom of the card.
- No magic-link option anywhere on the page.

### /signup (new)
- Fields: email, password (eye toggle; requirements shown inline up
  front). **No username field** — usernames already exist as an
  onboarding concern (chosen with the fictional-company identity, stored
  in `user_profiles.username`); duplicating the question at sign-up was
  rejected during planning (2026-07-19). Username login works once
  onboarding completes; until then the user signs in with email.
- One required consent checkbox: "I've read and agree to the
  [Terms of Service] and [Privacy Policy]" — both open the documents.
- Flow: submit → Supabase creates the account and sends a verification
  email → verified user lands in existing onboarding.
- Consent records are written at sign-up (see Consent). Because the user
  is not yet authenticated at that moment (email unverified), the sign-up
  server action records the agreement rows with the service-role client,
  keyed to the newly created user id — the checkbox moment is the true
  consent timestamp.

### /auth/reset (new)
- Request screen: enter email → Supabase `resetPasswordForEmail` (reuses the
  existing `/auth/callback` plumbing).
- Update screen: set new password (with toggle + inline requirements).
- The request screen always reports success identically whether or not the
  email exists (no account enumeration).
- This flow is also how pre-existing magic-link accounts set their first
  password.

### /terms and /privacy (new)
- Full drafted documents (personal-finance-appropriate: what we store, no
  selling of data, privacy-by-design commitments, demo status).
- Each shows a **version identifier and effective date**.
- Visible banner: draft pending legal review.

## Sign-in mechanics

- Sign-in runs in a **server action**:
  1. If the identifier contains `@`, treat it as an email.
  2. Otherwise resolve username → email **server-side only** (anonymous
     clients can never query usernames; RLS keeps `user_profiles`
     unreadable to signed-out users).
  3. Call Supabase `signInWithPassword` with the resolved email via the
     SSR server client (so cookies are set).
- **Generic errors:** unknown username, unknown email, and wrong password
  all return the identical "Invalid credentials" message. No code path may
  reveal whether an identifier exists.
- Username rules: 3–20 chars, letters/numbers/underscores (matches the
  existing onboarding validation), unique case-insensitively.

## Database (migration 0010)

- `user_profiles.username` **already exists** (not null, unique, populated
  at onboarding). Migration only adds a case-insensitive unique index on
  `lower(username)` so `Tui` and `tui` can't coexist.
- `user_agreements` (new table):
  - `user_id uuid references auth.users`
  - `document text check (document in ('terms', 'privacy'))`
  - `version text`
  - `accepted_at timestamptz default now()`
  - Unique on `(user_id, document, version)`. Insert-only for owners
    (RLS: select/insert own rows; no update/delete policies).
- **No data backfill.** All user-data tables are already RLS-keyed to
  `auth.uid()`, which is independent of auth method; adding a password
  attaches a credential to the same UUID and touches no data rows.

## Consent gate

- Current document versions are code constants (e.g.
  `TERMS_VERSION = "2026-07-19"`, `PRIVACY_VERSION = "2026-07-19"`).
- After any successful login, if the account lacks agreement rows for the
  **current** versions, route to a short consent page before the app.
- This single mechanism covers: existing accounts that never consented,
  and re-consent after any material document revision (bump the version
  constant). (Existing accounts already have usernames from onboarding,
  so the gate collects consent only.)

## Passwords

- Minimum 8 characters; enforced identically client-side and in Supabase
  config. Requirements stated up front, never revealed via error-message
  probing.
- Enable Supabase leaked-password protection (HaveIBeenPwned integration).
- Show/hide toggle is a real button with `aria-pressed` and accessible
  labels ("Show password" / "Hide password"); toggling preserves focus.

## Existing-account migration

No scripts. On first visit after ship:
1. User taps "Forgot password?" → email link → sets first password.
2. On login, the consent gate collects terms/privacy consent (usernames
   already exist from onboarding).

User base is currently the owner plus throwaway QA accounts, so this
one-time path is acceptable.

## Accessibility & mobile

- Designed and verified at ~390px first; desktop adapts.
- All states: loading, error, success; errors are text + iconography, never
  color alone.
- Full keyboard navigation; labeled controls throughout.

## Testing

- **Unit:** username validation; resolve-and-sign-in action, including the
  generic-error guarantee for all three failure modes; consent-gate logic
  (missing rows, stale versions).
- **Playwright e2e:** sign-up → verify → consent → onboarding; login with
  email; login with username; wrong password (generic error); reset flow;
  consent gate for a pre-existing account.
- `pnpm check` green before completion.

## Documentation

- DECISIONS.md entry: auth method change, alternatives (keep magic link,
  phone auth), reasoning.
- KNOWN_LIMITATIONS.md: legal documents are drafts pending lawyer review;
  phone sign-in deferred.
- CURRENT_PHASE.md updated after the slice ships.

## Out of scope

- Phone sign-in (later; requires SMS provider — Twilio or similar).
- 2FA / MFA.
- Session management UI ("sign out other devices").
- Username changes after sign-up.
- Lawyer review of legal documents (tracked as limitation).
