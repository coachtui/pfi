# Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace magic-link-only sign-in with email-or-username + password auth, plus sign-up, password reset, versioned terms/privacy consent, and a post-login consent gate.

**Architecture:** All auth mutations run in server actions (`src/app/actions/auth.ts`) using the existing `@supabase/ssr` server client; a new service-role admin client handles the two operations that must bypass RLS (username→email resolution pre-auth, consent rows at sign-up). Consent versions are code constants; the proxy (middleware) enforces the consent gate with a cookie cache so it costs one DB query per session, not per request. Spec: `docs/superpowers/specs/2026-07-19-password-auth-design.md`.

**Tech Stack:** Next.js 16 App Router server actions + `useActionState`, Supabase auth (`signInWithPassword`, `signUp`, `resetPasswordForEmail`), Zod, lucide-react (Eye/EyeOff), Vitest, Playwright.

## Global Constraints

- Generic auth error string, exactly: `Invalid email/username or password.` — every login failure path (unknown username, unknown email, wrong password) returns this identical string. No path may reveal whether an identifier exists.
- Reset-request and sign-up flows always report the same success message whether or not the email already has an account.
- Username rules: `/^[a-zA-Z0-9_]{3,20}$/`, unique case-insensitively (matches existing onboarding validation).
- Password: min 8 chars, max 72 (bcrypt limit). Requirements shown up front, never revealed via error probing.
- Document versions: `TERMS_VERSION = "2026-07-19"`, `PRIVACY_VERSION = "2026-07-19"`.
- **Keep the hash-token effect in `LoginForm.tsx`** — e2e session minting (`/login#access_token=...`) depends on it. Remove only the magic-link *UI*.
- Mobile-first: verify every new screen at ~390px before desktop. Never communicate state through color alone. All controls labeled for screen readers.
- Tailwind design tokens only (`text-primary`, `bg-inset`, `border-border-subtle`, etc. — see `src/app/globals.css`); match the existing input/button classes used in `LoginForm.tsx`.
- `pnpm check` (lint + typecheck + test + build) green before completion claims.
- Commit after every task with the message given in the task.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0010_password_auth.sql` | create | `user_agreements` table, case-insensitive username index |
| `src/lib/config/env.server.ts` (+ `.test.ts`) | create | lazy validation of `SUPABASE_SERVICE_ROLE_KEY` |
| `src/lib/supabase/admin.ts` | create | service-role client factory |
| `src/lib/legal/versions.ts` | create | document version constants |
| `src/lib/legal/consent.ts` (+ `.test.ts`) | create | pure `missingAgreements()` logic |
| `src/lib/validation/auth.ts` (+ `.test.ts`) | create | zod schemas + `escapeLikePattern` |
| `src/components/ui/PasswordInput.tsx` | create | password field with eye toggle |
| `src/components/legal/LegalPage.tsx` | create | shared legal-document layout |
| `src/app/terms/page.tsx`, `src/app/privacy/page.tsx` | create | drafted legal documents |
| `src/app/actions/auth.ts` | modify | sign-in/up/reset/update/consent actions |
| `src/app/auth/callback/route.ts` | modify | safe `next` redirect param |
| `src/app/login/LoginForm.tsx` | modify | password login form |
| `src/app/signup/page.tsx` + `SignupForm.tsx` | create | sign-up with consent checkbox |
| `src/app/auth/reset/page.tsx` + `RequestResetForm.tsx` | create | reset request |
| `src/app/auth/reset/update/page.tsx` + `UpdatePasswordForm.tsx` | create | set new password |
| `src/app/consent/page.tsx` + `ConsentForm.tsx` | create | post-login consent gate page |
| `src/proxy.ts` | modify | public prefixes + consent gate |
| `e2e/global-setup.ts`, `e2e/fixtures/*` | modify | consent rows for minted users |
| `e2e/password-auth.spec.ts` | create | end-to-end auth coverage |

---

### Task 1: Migration 0010 — agreements table + username index

**Files:**
- Create: `supabase/migrations/0010_password_auth.sql`

**Interfaces:**
- Produces: table `public.user_agreements(user_id, document, version, accepted_at)` with owner-only select/insert RLS; unique index on `lower(username)`.

- [ ] **Step 1: Write the migration**

```sql
-- Password auth: consent proof records + case-insensitive username uniqueness.

-- `Tui` and `tui` must not coexist; username login resolves case-insensitively.
create unique index user_profiles_username_lower_key
  on public.user_profiles (lower(username));

-- Immutable proof of consent. References auth.users (not user_profiles)
-- because consent is recorded at sign-up, before onboarding creates a profile.
create table public.user_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

alter table public.user_agreements enable row level security;

create policy "own agreements select" on public.user_agreements
  for select using ((select auth.uid()) = user_id);

create policy "own agreements insert" on public.user_agreements
  for insert with check ((select auth.uid()) = user_id);

-- Deliberately no update/delete policies: agreements are append-only proof.
```

- [ ] **Step 2: Apply to the linked project**

Run: `supabase db push`
Expected: `Applying migration 0010_password_auth.sql... Finished supabase db push.`
If it fails on the unique index, two existing usernames collide case-insensitively — list them with the SQL editor (`select username from user_profiles`) and rename one via the dashboard before re-running (QA throwaway accounts; safe to rename).

- [ ] **Step 3: Verify**

Run: `pnpm test:rls` (existing RLS harness must stay green)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_password_auth.sql
git commit -m "feat(auth): add user_agreements table and case-insensitive username index"
```

---

### Task 2: Server env + admin client

**Files:**
- Create: `src/lib/config/env.server.ts`, `src/lib/config/env.server.test.ts`, `src/lib/supabase/admin.ts`

**Interfaces:**
- Produces: `serviceRoleKey(source?): string` (throws when missing); `createAdminClient()` returning a service-role `SupabaseClient`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test** (`src/lib/config/env.server.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { serviceRoleKey } from "./env.server";

describe("serviceRoleKey", () => {
  it("returns the key when set", () => {
    expect(serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "sk-test" } as NodeJS.ProcessEnv)).toBe("sk-test");
  });

  it("throws a descriptive error when missing", () => {
    expect(() => serviceRoleKey({} as NodeJS.ProcessEnv)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when empty string", () => {
    expect(() => serviceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "" } as NodeJS.ProcessEnv)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/config/env.server.test.ts`
Expected: FAIL — cannot resolve `./env.server`

- [ ] **Step 3: Implement** (`src/lib/config/env.server.ts`)

```ts
/**
 * Server-only env. Validated lazily (at first use, not import) so client
 * bundles and builds without the key still succeed — only the auth actions
 * that need service-role access fail loudly if it's absent.
 */
export function serviceRoleKey(source: NodeJS.ProcessEnv = process.env): string {
  const key = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for auth actions. Set it in .env.local (dev) and the Vercel project env (production).",
    );
  }
  return key;
}
```

And `src/lib/supabase/admin.ts`:

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/config/env";
import { serviceRoleKey } from "@/lib/config/env.server";

/**
 * Service-role Supabase client. Bypasses RLS — server-side only, never
 * import from a client component. Used exclusively for: (1) resolving
 * username → email before authentication, (2) recording sign-up consent
 * for a not-yet-verified user.
 */
export function createAdminClient() {
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/config/env.server.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/env.server.ts src/lib/config/env.server.test.ts src/lib/supabase/admin.ts
git commit -m "feat(auth): server-only env validation and service-role admin client"
```

---

### Task 3: Legal versions + consent logic

**Files:**
- Create: `src/lib/legal/versions.ts`, `src/lib/legal/consent.ts`, `src/lib/legal/consent.test.ts`

**Interfaces:**
- Produces: `TERMS_VERSION`, `PRIVACY_VERSION`, `CURRENT_AGREEMENTS: readonly {document, version}[]`, `AGREED_COOKIE = "pfi_agreed"`, `agreedCookieValue(): string`, `missingAgreements(rows: {document: string; version: string}[]): {document: string; version: string}[]`. Consumed by Tasks 7, 11.

- [ ] **Step 1: Write the failing test** (`src/lib/legal/consent.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { missingAgreements } from "./consent";
import { PRIVACY_VERSION, TERMS_VERSION, agreedCookieValue } from "./versions";

describe("missingAgreements", () => {
  it("reports both documents for a user with no rows", () => {
    expect(missingAgreements([])).toEqual([
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: PRIVACY_VERSION },
    ]);
  });

  it("reports only the stale document", () => {
    const rows = [
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: "2020-01-01" },
    ];
    expect(missingAgreements(rows)).toEqual([{ document: "privacy", version: PRIVACY_VERSION }]);
  });

  it("reports nothing when both current versions are present (extra old rows ignored)", () => {
    const rows = [
      { document: "terms", version: "2020-01-01" },
      { document: "terms", version: TERMS_VERSION },
      { document: "privacy", version: PRIVACY_VERSION },
    ];
    expect(missingAgreements(rows)).toEqual([]);
  });
});

describe("agreedCookieValue", () => {
  it("encodes both current versions", () => {
    expect(agreedCookieValue()).toBe(`${TERMS_VERSION}|${PRIVACY_VERSION}`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/legal/consent.test.ts`
Expected: FAIL — cannot resolve `./consent`

- [ ] **Step 3: Implement**

`src/lib/legal/versions.ts`:

```ts
/**
 * Effective versions of the legal documents. Bump a version when its
 * document materially changes — the consent gate then re-prompts every
 * user. Never edit a document's content without bumping its version.
 */
export const TERMS_VERSION = "2026-07-19";
export const PRIVACY_VERSION = "2026-07-19";

export type AgreementDocument = "terms" | "privacy";

export const CURRENT_AGREEMENTS: readonly { document: AgreementDocument; version: string }[] = [
  { document: "terms", version: TERMS_VERSION },
  { document: "privacy", version: PRIVACY_VERSION },
];

/** Cookie that caches "this session already proved consent" (proxy gate). */
export const AGREED_COOKIE = "pfi_agreed";

export function agreedCookieValue(): string {
  return `${TERMS_VERSION}|${PRIVACY_VERSION}`;
}
```

`src/lib/legal/consent.ts`:

```ts
import { CURRENT_AGREEMENTS } from "./versions";

export interface AgreementRow {
  document: string;
  version: string;
}

/** Which current-version agreements this user still lacks. Empty = fully consented. */
export function missingAgreements(rows: AgreementRow[]): { document: string; version: string }[] {
  return CURRENT_AGREEMENTS.filter(
    (required) => !rows.some((r) => r.document === required.document && r.version === required.version),
  );
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/legal/consent.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/legal/
git commit -m "feat(auth): legal document versions and consent-gap logic"
```

---

### Task 4: Auth validation schemas

**Files:**
- Create: `src/lib/validation/auth.ts`, `src/lib/validation/auth.test.ts`

**Interfaces:**
- Produces: `PASSWORD_MIN = 8`, `passwordSchema`, `loginSchema` (`{identifier, password}`), `signupSchema` (`{email, password, consent}` — consent must be `true`), `resetRequestSchema` (`{email}`), `updatePasswordSchema` (`{password}`), `escapeLikePattern(s: string): string`. Consumed by Tasks 7–10.

- [ ] **Step 1: Write the failing test** (`src/lib/validation/auth.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  escapeLikePattern,
  loginSchema,
  signupSchema,
  updatePasswordSchema,
} from "./auth";

describe("signupSchema", () => {
  it("accepts a valid signup", () => {
    expect(
      signupSchema.safeParse({ email: "a@b.com", password: "longenough", consent: true }).success,
    ).toBe(true);
  });

  it("rejects passwords under 8 chars", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "short", consent: true }).success).toBe(false);
  });

  it("rejects passwords over 72 chars (bcrypt limit)", () => {
    expect(
      signupSchema.safeParse({ email: "a@b.com", password: "x".repeat(73), consent: true }).success,
    ).toBe(false);
  });

  it("rejects missing consent", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "longenough", consent: false }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts email or username identifiers", () => {
    expect(loginSchema.safeParse({ identifier: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "IslandBuilder", password: "x" }).success).toBe(true);
  });

  it("rejects empty fields", () => {
    expect(loginSchema.safeParse({ identifier: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "a@b.com", password: "" }).success).toBe(false);
  });

  it("trims the identifier", () => {
    const parsed = loginSchema.parse({ identifier: "  tui  ", password: "x" });
    expect(parsed.identifier).toBe("tui");
  });
});

describe("updatePasswordSchema", () => {
  it("enforces the same password rules", () => {
    expect(updatePasswordSchema.safeParse({ password: "short" }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({ password: "longenough" }).success).toBe(true);
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards so underscores match literally", () => {
    // Without escaping, ilike("a_c") would also match "abc".
    expect(escapeLikePattern("a_c")).toBe("a\\_c");
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/validation/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`

- [ ] **Step 3: Implement** (`src/lib/validation/auth.ts`)

```ts
import { z } from "zod";

export const PASSWORD_MIN = 8;
/** 72 is bcrypt's input limit — longer passwords would be silently truncated. */
export const PASSWORD_MAX = 72;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

export const signupSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: passwordSchema,
  consent: z.literal(true, "You must agree to the Terms of Service and Privacy Policy"),
});

export const resetRequestSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export const updatePasswordSchema = z.object({
  password: passwordSchema,
});

/**
 * Escape `%`, `_`, and `\` so a PostgREST ilike() does an exact
 * case-insensitive match. Usernames allow underscores, which are
 * single-char wildcards in LIKE patterns — unescaped, "a_c" matches "abc".
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/lib/validation/auth.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/auth.ts src/lib/validation/auth.test.ts
git commit -m "feat(auth): validation schemas for login, signup, and reset"
```

---

### Task 5: Terms & Privacy pages

**Files:**
- Create: `src/components/legal/LegalPage.tsx`, `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`
- Modify: `src/proxy.ts` (add public prefixes only — the consent gate is Task 11)

**Interfaces:**
- Consumes: `TERMS_VERSION`, `PRIVACY_VERSION` from Task 3; `branding` from `src/lib/config/branding.ts`.
- Produces: public routes `/terms` and `/privacy`.

- [ ] **Step 1: Shared layout** (`src/components/legal/LegalPage.tsx`)

```tsx
import Link from "next/link";
import { branding } from "@/lib/config/branding";

interface LegalPageProps {
  title: string;
  version: string;
  children: React.ReactNode;
}

/** Shared frame for legal documents: title, version stamp, draft banner. */
export function LegalPage({ title, version, children }: LegalPageProps) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">{title}</h1>
        <p className="mt-1 text-sm text-secondary">
          {branding.productName} · Version {version} · Effective {version}
        </p>
        <p className="mt-3 rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-secondary" role="note">
          Draft pending legal review. This document reflects our real commitments but has not yet
          been reviewed by a lawyer.
        </p>
      </header>
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-secondary [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-primary">
        {children}
      </div>
      <footer className="mt-8 text-sm">
        <Link href="/login" className="text-primary underline underline-offset-4">
          Back to sign in
        </Link>
      </footer>
    </article>
  );
}
```

- [ ] **Step 2: Terms page** (`src/app/terms/page.tsx`)

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { TERMS_VERSION } from "@/lib/legal/versions";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: `Terms of Service — ${branding.productName}` };

export default function TermsPage() {
  const name = branding.productName;
  return (
    <LegalPage title="Terms of Service" version={TERMS_VERSION}>
      <section>
        <h2>1. Agreement</h2>
        <p>
          By creating an account you agree to these Terms of Service and to the Privacy Policy. If
          you do not agree, do not use {name}.
        </p>
      </section>
      <section>
        <h2>2. What {name} is — and is not</h2>
        <p>
          {name} is an educational analytics tool that presents your household finances the way a
          public company presents its performance. It is <strong>not</strong> financial, investment,
          tax, or legal advice, and no output — including any score — is a credit score or a
          recommendation to buy or sell anything. Decisions you make remain your own.
        </p>
      </section>
      <section>
        <h2>3. Your account</h2>
        <p>
          You must provide a valid email address and keep your password confidential. You are
          responsible for activity under your account. You may close your account at any time,
          which deletes your data as described in the Privacy Policy.
        </p>
      </section>
      <section>
        <h2>4. Your data, your ownership</h2>
        <p>
          Financial data you enter or import remains yours. You grant {name} only the processing
          rights needed to compute and display your own metrics. We never sell your data.
        </p>
      </section>
      <section>
        <h2>5. Acceptable use</h2>
        <p>
          Do not attempt to access other users&rsquo; data, probe or disrupt the service, or use it
          for unlawful purposes.
        </p>
      </section>
      <section>
        <h2>6. Accuracy and availability</h2>
        <p>
          Calculations are deterministic and explainable, but depend on the completeness of the data
          you provide. The service is provided &ldquo;as is&rdquo;, without warranty, and may change
          or be interrupted while in active development.
        </p>
      </section>
      <section>
        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {name} is not liable for indirect or
          consequential damages, or for financial outcomes of decisions informed by the product.
        </p>
      </section>
      <section>
        <h2>8. Changes</h2>
        <p>
          If these terms materially change, the version above changes and you will be asked to
          review and accept the new version at your next sign-in before continuing.
        </p>
      </section>
      <section>
        <h2>9. Contact</h2>
        <p>Questions: tui@tuialailima.com.</p>
      </section>
    </LegalPage>
  );
}
```

- [ ] **Step 3: Privacy page** (`src/app/privacy/page.tsx`)

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { PRIVACY_VERSION } from "@/lib/legal/versions";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: `Privacy Policy — ${branding.productName}` };

export default function PrivacyPage() {
  const name = branding.productName;
  return (
    <LegalPage title="Privacy Policy" version={PRIVACY_VERSION}>
      <section>
        <h2>1. What we collect</h2>
        <p>
          Your email address and password hash (for authentication); the profile answers you give at
          onboarding (broad cohorts like age range and income band — never exact salary); and the
          financial account, balance, and transaction data you enter or import.
        </p>
      </section>
      <section>
        <h2>2. How we use it</h2>
        <p>
          Solely to compute and show you your own metrics, index, and score. AI-generated
          commentary receives only structured, already-computed metrics — never your raw
          transactions or account credentials.
        </p>
      </section>
      <section>
        <h2>3. What we never do</h2>
        <p>
          We never sell your data. We never rank or expose users by wealth. Product analytics never
          receive raw balances, transaction values, or merchant names. Public surfaces show only
          your fictional company identity, indexed values, percentiles, and broad bands — never your
          real identity or dollar amounts.
        </p>
      </section>
      <section>
        <h2>4. Where it lives</h2>
        <p>
          Data is stored with Supabase (Postgres) with row-level security: every table is readable
          and writable only by the account that owns the rows. Passwords are stored as salted
          hashes; we cannot read them.
        </p>
      </section>
      <section>
        <h2>5. Sharing</h2>
        <p>
          No third parties receive your personal data except infrastructure processors (hosting,
          database, email delivery) bound to process it only on our behalf.
        </p>
      </section>
      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          Data is kept while your account exists. Deleting your account deletes your data (database
          rows cascade from your user record). Backups age out on the infrastructure provider&rsquo;s
          schedule.
        </p>
      </section>
      <section>
        <h2>7. Your rights</h2>
        <p>
          You can view, correct, export, or delete your data. Email tui@tuialailima.com for anything
          the product UI does not yet cover.
        </p>
      </section>
      <section>
        <h2>8. Changes</h2>
        <p>
          Material changes bump the version above, and you will be asked to review and accept the
          new version at your next sign-in.
        </p>
      </section>
    </LegalPage>
  );
}
```

- [ ] **Step 4: Make the routes public** — in `src/proxy.ts` change:

```ts
const PUBLIC_PREFIXES = ["/login", "/auth"];
```

to:

```ts
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/terms", "/privacy"];
```

(`/signup` is added now so Task 9's page works without another proxy edit.)

- [ ] **Step 5: Verify in browser**

Run: `pnpm dev`, open `http://localhost:3000/terms` and `/privacy` signed out.
Expected: both render (no login redirect), version stamp "2026-07-19", draft banner visible. Check at ~390px width and desktop.

- [ ] **Step 6: Commit**

```bash
git add src/components/legal/ src/app/terms/ src/app/privacy/ src/proxy.ts
git commit -m "feat(auth): drafted terms of service and privacy policy pages"
```

---

### Task 6: PasswordInput component

**Files:**
- Create: `src/components/ui/PasswordInput.tsx`

**Interfaces:**
- Produces: `<PasswordInput id name autoComplete ... />` — standard input props minus `type`. Consumed by Tasks 8, 9, 10.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password field with a show/hide toggle. The toggle is a real button
 * (keyboard focusable, aria-pressed, explicit label) and flipping it never
 * moves focus or clears the value.
 */
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={
          className ??
          "w-full rounded-xl border border-border-subtle bg-inset px-4 py-3 pr-12 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none"
        }
        {...props}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-tertiary hover:text-primary focus:outline-none focus-visible:text-primary"
      >
        {visible ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/PasswordInput.tsx
git commit -m "feat(auth): PasswordInput with accessible show/hide toggle"
```

---

### Task 7: Auth server actions + callback `next` param

**Files:**
- Modify: `src/app/actions/auth.ts` (keep the existing `signOut`)
- Modify: `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 2), schemas + `escapeLikePattern` (Task 4), `CURRENT_AGREEMENTS`/`missingAgreements` (Task 3).
- Produces (all `(prev: AuthFormState, formData: FormData) => Promise<AuthFormState>` unless noted, for `useActionState`):
  - `signInWithPassword` — redirects to `/` or `/consent` on success
  - `signUpWithPassword` — returns `{message}` on success
  - `requestPasswordReset` — returns `{message}` always
  - `updatePassword` — redirects to `/` on success
  - `acceptAgreements(): Promise<AuthFormState>` — no formData; redirects to `/`
  - `export type AuthFormState = { error?: string; message?: string }`

- [ ] **Step 1: Rewrite `src/app/actions/auth.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  escapeLikePattern,
  loginSchema,
  resetRequestSchema,
  signupSchema,
  updatePasswordSchema,
} from "@/lib/validation/auth";
import { CURRENT_AGREEMENTS } from "@/lib/legal/versions";
import { missingAgreements } from "@/lib/legal/consent";

export type AuthFormState = { error?: string; message?: string };

/** Identical for unknown username, unknown email, and wrong password — never reveals which. */
const INVALID_CREDENTIALS = "Invalid email/username or password.";

async function requestOrigin(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("origin") ?? "http://localhost:3000";
}

/**
 * Resolve a login identifier to an email. Usernames are looked up with the
 * service-role client (profiles are unreadable pre-auth under RLS) —
 * anonymous browsers can never run this query themselves.
 */
async function emailForIdentifier(identifier: string): Promise<string | null> {
  if (identifier.includes("@")) return identifier;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("id")
    .ilike("username", escapeLikePattern(identifier))
    .maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(profile.id);
  return data.user?.email ?? null;
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: INVALID_CREDENTIALS };

  const email = await emailForIdentifier(parsed.data.identifier);
  if (!email) return { error: INVALID_CREDENTIALS };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error || !data.user) return { error: INVALID_CREDENTIALS };

  const { data: rows } = await supabase
    .from("user_agreements")
    .select("document, version")
    .eq("user_id", data.user.id);
  redirect(missingAgreements(rows ?? []).length > 0 ? "/consent" : "/");
}

export async function signUpWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    consent: formData.get("consent") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: "Could not create the account. Try again." };

  // Supabase returns an obfuscated user with no identities when the email
  // already has an account. Only record consent for genuinely new users,
  // but report the identical message either way (no email enumeration).
  const isNewUser = (data.user?.identities?.length ?? 0) > 0;
  if (isNewUser && data.user) {
    const admin = createAdminClient();
    // Service-role insert: the user can't write their own rows yet (email
    // unverified, no session). The checkbox moment is the consent timestamp.
    const { error: consentError } = await admin.from("user_agreements").insert(
      CURRENT_AGREEMENTS.map((a) => ({
        user_id: data.user!.id,
        document: a.document,
        version: a.version,
      })),
    );
    if (consentError) return { error: "Could not create the account. Try again." };
  }
  return {
    message: `Check your email — we sent a verification link to ${parsed.data.email}.`,
  };
}

export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const origin = await requestOrigin();
  const supabase = await createClient();
  // Result deliberately ignored: the response must be identical whether or
  // not the email has an account.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset/update`,
  });
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link expired or was already used. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Could not update the password. Try again." };
  redirect("/");
}

export async function acceptAgreements(): Promise<AuthFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Authenticated insert under the user's own RLS; ignoreDuplicates makes
  // re-submits harmless.
  const { error } = await supabase.from("user_agreements").upsert(
    CURRENT_AGREEMENTS.map((a) => ({ user_id: user.id, document: a.document, version: a.version })),
    { onConflict: "user_id,document,version", ignoreDuplicates: true },
  );
  if (error) return { error: "Could not record your consent. Try again." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Callback `next` support** — replace `src/app/auth/callback/route.ts` body:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-site relative paths — never an absolute URL (open-redirect guard).
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: 0 type errors; full unit suite PASS (nothing imports the new actions yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/auth.ts src/app/auth/callback/route.ts
git commit -m "feat(auth): password sign-in/up, reset, and consent server actions"
```

---

### Task 8: Login page rebuild

**Files:**
- Modify: `src/app/login/LoginForm.tsx`

**Interfaces:**
- Consumes: `signInWithPassword`, `AuthFormState` (Task 7); `PasswordInput` (Task 6).

- [ ] **Step 1: Rewrite the form.** KEEP the entire hash-token `useEffect`, the `status === "authenticating"` branch, and the `hashError`/`linkError` handling exactly as they are (e2e session minting depends on the hash flow). Replace the magic-link form with:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { signInWithPassword, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signInWithPassword,
    {},
  );
  const [status, setStatus] = useState<"idle" | "authenticating">("idle");
  const [hashError, setHashError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const linkError = params.get("error");

  // ... existing hash-token useEffect, byte-for-byte unchanged ...

  if (status === "authenticating") {
    return (
      <Card className="p-6">
        <p className="text-sm text-primary" role="status">
          Signing you in…
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="identifier" className="text-sm font-medium text-primary">
          Email or username
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          required
          autoComplete="username"
          placeholder="you@example.com or IslandBuilder"
          className={inputCls}
        />
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm font-medium text-primary">
            Password
          </label>
          <Link
            href="/auth/reset"
            className="text-xs text-secondary underline underline-offset-4 hover:text-primary"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput id="password" name="password" required autoComplete="current-password" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {(state.error || linkError || hashError) && (
          <p className="text-sm text-negative" role="alert">
            {hashError ??
              state.error ??
              "That sign-in link expired or was invalid. Try again."}
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-secondary">
        New here?{" "}
        <Link href="/signup" className="text-primary underline underline-offset-4">
          Create account
        </Link>
      </p>
      <p className="mt-3 text-center text-xs text-tertiary">
        <Link href="/terms" className="underline underline-offset-4 hover:text-secondary">
          Terms of Service
        </Link>
        {" · "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-secondary">
          Privacy Policy
        </Link>
      </p>
    </Card>
  );
}
```

Notes for the implementer:
- The old `status` union loses `"sending" | "sent" | "error"`; the hash effect's `setStatus("idle")` error path stays valid. Delete the `submit` function and the `email` state entirely.
- `signInWithOtp` disappears from this file; the `createClient` import stays (hash effect uses it).

- [ ] **Step 2: Verify in browser**

Run: `pnpm dev`, open `/login` at ~390px and desktop.
Expected: identifier + password fields, eye toggle shows/hides the password without losing focus, forgot-password + create-account + terms/privacy links all navigate. Submitting garbage shows exactly "Invalid email/username or password."

- [ ] **Step 3: Verify e2e session minting still works**

Run: `pnpm test:e2e`
Expected: existing smoke/manifest specs PASS (the hash-token flow is what they use to sign in).

- [ ] **Step 4: Commit**

```bash
git add src/app/login/LoginForm.tsx
git commit -m "feat(auth): password login form with identifier, toggle, and legal links"
```

---

### Task 9: Signup page

**Files:**
- Create: `src/app/signup/page.tsx`, `src/app/signup/SignupForm.tsx`

**Interfaces:**
- Consumes: `signUpWithPassword`, `AuthFormState` (Task 7); `PasswordInput` (Task 6); `PASSWORD_MIN` (Task 4).

- [ ] **Step 1: Page** (`src/app/signup/page.tsx` — mirrors `login/page.tsx` structure)

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: `Create account — ${branding.productName}` };

export default function SignupPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">{branding.productName}</h1>
        <p className="mt-1 text-sm text-secondary">{branding.tagline}</p>
      </header>
      <SignupForm />
      <p className="text-center text-xs text-tertiary">
        {branding.productName} is an educational analytics tool, not financial advice.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Form** (`src/app/signup/SignupForm.tsx`)

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { signUpWithPassword, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signUpWithPassword,
    {},
  );

  if (state.message) {
    return (
      <Card className="p-6">
        <p className="text-sm text-primary" role="status">
          {state.message}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium text-primary">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={inputCls}
        />
        <label htmlFor="password" className="text-sm font-medium text-primary">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-tertiary">
          At least {PASSWORD_MIN} characters.
        </p>
        <label className="flex items-start gap-3 text-sm text-secondary">
          <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-current" />
          <span>
            I&rsquo;ve read and agree to the{" "}
            <Link href="/terms" target="_blank" className="text-primary underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="text-primary underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
        {state.error && (
          <p className="text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
```

- [ ] **Step 3: Redirect signed-in users away from /signup** — in `src/proxy.ts` change:

```ts
  if (user && path === "/login") {
```

to:

```ts
  if (user && (path === "/login" || path === "/signup")) {
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm dev`, open `/signup` at ~390px and desktop.
Expected: submit is blocked until the consent box is checked (native `required`); a valid new email shows the "Check your email" message; repeating with the same email shows the identical message.

- [ ] **Step 5: Commit**

```bash
git add src/app/signup/ src/proxy.ts
git commit -m "feat(auth): signup page with consent checkbox"
```

---

### Task 10: Password reset pages

**Files:**
- Create: `src/app/auth/reset/page.tsx`, `src/app/auth/reset/RequestResetForm.tsx`, `src/app/auth/reset/update/page.tsx`, `src/app/auth/reset/update/UpdatePasswordForm.tsx`

**Interfaces:**
- Consumes: `requestPasswordReset`, `updatePassword`, `AuthFormState` (Task 7); `PasswordInput` (Task 6); `PASSWORD_MIN` (Task 4).

- [ ] **Step 1: Request page** (`src/app/auth/reset/page.tsx`)

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { RequestResetForm } from "./RequestResetForm";

export const metadata: Metadata = { title: `Reset password — ${branding.productName}` };

export default function ResetRequestPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">Reset your password</h1>
        <p className="mt-1 text-sm text-secondary">
          We&rsquo;ll email you a link to set a new one.
        </p>
      </header>
      <RequestResetForm />
    </div>
  );
}
```

- [ ] **Step 2: Request form** (`src/app/auth/reset/RequestResetForm.tsx`)

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { requestPasswordReset, type AuthFormState } from "@/app/actions/auth";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";

export function RequestResetForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <Card className="p-6">
      {state.message ? (
        <p className="text-sm text-primary" role="status">
          {state.message}
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <label htmlFor="email" className="text-sm font-medium text-primary">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className={inputCls}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
          >
            {pending ? "Sending…" : "Email me a reset link"}
          </button>
          {state.error && (
            <p className="text-sm text-negative" role="alert">
              {state.error}
            </p>
          )}
        </form>
      )}
      <p className="mt-4 text-center text-sm text-secondary">
        <Link href="/login" className="text-primary underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
```

- [ ] **Step 3: Update page** (`src/app/auth/reset/update/page.tsx`)

```tsx
import type { Metadata } from "next";
import { branding } from "@/lib/config/branding";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export const metadata: Metadata = { title: `New password — ${branding.productName}` };

export default function UpdatePasswordPage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">Set a new password</h1>
      </header>
      <UpdatePasswordForm />
    </div>
  );
}
```

- [ ] **Step 4: Update form** (`src/app/auth/reset/update/UpdatePasswordForm.tsx`)

```tsx
"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN } from "@/lib/validation/auth";
import { updatePassword, type AuthFormState } from "@/app/actions/auth";

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    updatePassword,
    {},
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label htmlFor="password" className="text-sm font-medium text-primary">
          New password
        </label>
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={PASSWORD_MIN}
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-tertiary">
          At least {PASSWORD_MIN} characters.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save password"}
        </button>
        {state.error && (
          <p className="text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: Verify in browser**

Run: `pnpm dev`.
- `/auth/reset` with an unknown email → "If that email has an account, a reset link is on its way." (identical for a known email).
- Real reset: request for your own account's email, open the emailed link → lands on `/auth/reset/update` (via callback `next`), set a new password → redirected to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/app/auth/reset/
git commit -m "feat(auth): password reset request and update pages"
```

---

### Task 11: Consent page + proxy consent gate

**Files:**
- Create: `src/app/consent/page.tsx`, `src/app/consent/ConsentForm.tsx`
- Modify: `src/proxy.ts`, `e2e/global-setup.ts`

**Interfaces:**
- Consumes: `acceptAgreements` (Task 7); `AGREED_COOKIE`, `agreedCookieValue`, versions (Task 3); `missingAgreements` (Task 3).

- [ ] **Step 1: Consent page** (`src/app/consent/page.tsx`)

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { branding } from "@/lib/config/branding";
import { createClient } from "@/lib/supabase/server";
import { missingAgreements } from "@/lib/legal/consent";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { ConsentForm } from "./ConsentForm";

export const metadata: Metadata = { title: `Review terms — ${branding.productName}` };

export default async function ConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("user_agreements")
    .select("document, version")
    .eq("user_id", user.id);
  if (missingAgreements(rows ?? []).length === 0) redirect("/");

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-8">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-primary">One thing before you continue</h1>
        <p className="mt-1 text-sm text-secondary">
          Please review and accept the current Terms of Service (v{TERMS_VERSION}) and Privacy
          Policy (v{PRIVACY_VERSION}).
        </p>
      </header>
      <ConsentForm />
    </div>
  );
}
```

- [ ] **Step 2: Consent form** (`src/app/consent/ConsentForm.tsx`)

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { acceptAgreements, type AuthFormState } from "@/app/actions/auth";

export function ConsentForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    () => acceptAgreements(),
    {},
  );

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex items-start gap-3 text-sm text-secondary">
          <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 accent-current" />
          <span>
            I&rsquo;ve read and agree to the{" "}
            <Link href="/terms" target="_blank" className="text-primary underline underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="text-primary underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base transition-opacity disabled:opacity-60"
        >
          {pending ? "Saving…" : "Agree and continue"}
        </button>
        {state.error && (
          <p className="text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </Card>
  );
}
```

- [ ] **Step 3: Proxy consent gate** — in `src/proxy.ts`, after the existing `if (user && (path === "/login" || path === "/signup"))` block, add (plus the new imports at the top):

```ts
import { AGREED_COOKIE, agreedCookieValue } from "@/lib/legal/versions";
import { missingAgreements } from "@/lib/legal/consent";
```

```ts
  // Consent gate: one DB query per session (cookie-cached), not per request.
  // The cookie only skips the *check* — proof of consent is the DB rows.
  if (user && !isPublic && !path.startsWith("/consent")) {
    if (request.cookies.get(AGREED_COOKIE)?.value !== agreedCookieValue()) {
      const { data: rows } = await supabase
        .from("user_agreements")
        .select("document, version")
        .eq("user_id", user.id);
      if (missingAgreements(rows ?? []).length > 0) {
        const url = request.nextUrl.clone();
        url.pathname = "/consent";
        return NextResponse.redirect(url);
      }
      response.cookies.set(AGREED_COOKIE, agreedCookieValue(), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
  }
```

- [ ] **Step 4: Keep existing e2e users consenting** — in `e2e/global-setup.ts`, immediately after the `admin.auth.admin.createUser` succeeds, add:

```ts
  const { error: consentErr } = await admin.from("user_agreements").insert([
    { user_id: created.user.id, document: "terms", version: "2026-07-19" },
    { user_id: created.user.id, document: "privacy", version: "2026-07-19" },
  ]);
  if (consentErr) throw new Error(`e2e setup: consent insert failed: ${consentErr.message}`);
```

(Literal versions, not imports — e2e files don't share the app's TS path aliases. If global-teardown deletes the user, the rows cascade.)

- [ ] **Step 5: Verify**

Run: `pnpm test:e2e`
Expected: existing specs still PASS (minted user now has consent rows, so the gate lets them through).
Then manually: sign in as your own legacy account (no consent rows) → redirected to `/consent` → accept → dashboard loads; sign out/in again → no consent prompt.

- [ ] **Step 6: Commit**

```bash
git add src/app/consent/ src/proxy.ts e2e/global-setup.ts
git commit -m "feat(auth): post-login consent gate with cookie-cached proxy check"
```

---

### Task 12: Supabase & Vercel settings (manual checklist)

**Files:** none (dashboard + Vercel env). Record outcomes in the PR description.

- [ ] **Step 1: Vercel env** — add `SUPABASE_SERVICE_ROLE_KEY` to the Vercel project (Production + Preview): Vercel dashboard → pfi project → Settings → Environment Variables. Value = the same key already in `.env.local`. Without this, sign-up and username login fail in production with the descriptive error from Task 2.

- [ ] **Step 2: Supabase password policy** — Supabase dashboard → Authentication → Providers → Email: set **Minimum password length = 8**. Confirm **Confirm email** is ON (it already is — magic links used it).

- [ ] **Step 3: Leaked-password protection** — Supabase dashboard → Authentication → Attack Protection (or Settings → Security): enable **Leaked password protection** (HaveIBeenPwned). If the toggle is plan-gated on the current tier, skip and note it in KNOWN_LIMITATIONS (Task 14 covers the doc).

- [ ] **Step 4: Verify** — attempt a production sign-up with password `1234567` → rejected; with a known-breached password like `password123` → rejected if Step 3 succeeded.

---

### Task 13: E2E coverage

**Files:**
- Create: `e2e/password-auth.spec.ts`
- Modify: `e2e/fixtures/` (add the helper below to the existing fixtures file, or a new `e2e/fixtures/password-user.ts`)

**Interfaces:**
- Consumes: running app on `http://localhost:3100` (existing playwright config), `.env.local` service key.
- Produces: `createPasswordUser(opts): Promise<{email, username, password, userId}>`.

- [ ] **Step 1: Fixture helper** (`e2e/fixtures/password-user.ts`)

```ts
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export interface PasswordUser {
  email: string;
  username: string;
  password: string;
  userId: string;
}

/**
 * Mints a confirmed user with a password, an onboarded profile (so username
 * login resolves), and optionally consent rows (omit to exercise the gate).
 */
export async function createPasswordUser(opts: { consent: boolean }): Promise<PasswordUser> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, service);

  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-pw-${suffix}@example.com`;
  const username = `e2e_pw_${suffix}`;
  const password = `pw-${suffix}-Aa1`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`);

  const { error: profileErr } = await admin.from("user_profiles").insert({
    id: created.user.id,
    username,
    age_cohort: "30–39",
    income_band: "$50k–$100k",
    household_type: "Single",
    col_cohort: "Mid-Cost Region",
    objective: "reduce_debt",
    onboarding_completed_at: new Date().toISOString(),
  });
  if (profileErr) throw new Error(`profile insert failed: ${profileErr.message}`);

  if (opts.consent) {
    const { error: consentErr } = await admin.from("user_agreements").insert([
      { user_id: created.user.id, document: "terms", version: "2026-07-19" },
      { user_id: created.user.id, document: "privacy", version: "2026-07-19" },
    ]);
    if (consentErr) throw new Error(`consent insert failed: ${consentErr.message}`);
  }
  return { email, username, password, userId: created.user.id };
}

export async function deletePasswordUser(userId: string): Promise<void> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  await admin.auth.admin.deleteUser(userId);
}
```

- [ ] **Step 2: Spec** (`e2e/password-auth.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { createPasswordUser, deletePasswordUser, type PasswordUser } from "./fixtures/password-user";

const GENERIC_ERROR = "Invalid email/username or password.";

test.describe("password auth", () => {
  let user: PasswordUser;

  test.beforeAll(async () => {
    user = await createPasswordUser({ consent: true });
  });
  test.afterAll(async () => {
    await deletePasswordUser(user.userId);
  });

  test("logs in with email", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/login|consent/);
  });

  test("logs in with username", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.username.toUpperCase()); // case-insensitive
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/login/);
  });

  test("wrong password and unknown username produce the identical generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.username);
    await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText(GENERIC_ERROR);

    await page.getByLabel("Email or username").fill("no_such_user_zz");
    await page.getByLabel("Password", { exact: true }).fill("whatever-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText(GENERIC_ERROR);
  });

  test("show/hide toggle reveals the typed password", async ({ page }) => {
    await page.goto("/login");
    const pw = page.getByLabel("Password", { exact: true });
    await pw.fill("secret123");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(pw).toHaveAttribute("type", "password");
  });

  test("reset request reports identically for unknown emails", async ({ page }) => {
    await page.goto("/auth/reset");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If that email has an account");
  });

  test("signup requires consent and confirms without leaking existing emails", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(user.email); // existing account
    await page.getByLabel("Password", { exact: true }).fill("valid-password-1");
    // Consent unchecked → native validation blocks submit and we stay on /signup.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/signup/);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
  });
});

test.describe("consent gate", () => {
  let user: PasswordUser;

  test.beforeAll(async () => {
    user = await createPasswordUser({ consent: false });
  });
  test.afterAll(async () => {
    await deletePasswordUser(user.userId);
  });

  test("routes un-consented logins to /consent, then through after accepting", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email or username").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/consent");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL("**/");
    await expect(page).not.toHaveURL(/consent/);
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `pnpm test:e2e`
Expected: all new specs PASS plus the pre-existing smoke/manifest specs.

- [ ] **Step 4: Commit**

```bash
git add e2e/password-auth.spec.ts e2e/fixtures/password-user.ts
git commit -m "test(auth): e2e coverage for password login, signup, reset, and consent gate"
```

---

### Task 14: Docs, full check, visual verification

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/CURRENT_PHASE.md`

- [ ] **Step 1: DECISIONS.md** — append entry #28 (follow the existing entry format exactly: date, decision, alternatives, reasoning, consequences):

> **#28 — 2026-07-19 — Password auth replaces magic-link sign-in.** Login = email-or-username + password; username resolution is server-side service-role only, all login failures return one generic message. Consent to versioned Terms/Privacy is recorded in `user_agreements` at sign-up, enforced post-login by a cookie-cached proxy gate. Alternatives: keep magic-link UI as fallback (rejected — passwords only, reset flow covers migration); phone auth (deferred — needs SMS provider); username field at sign-up (rejected — username already lives in onboarding). Consequences: `SUPABASE_SERVICE_ROLE_KEY` becomes a required production secret; legal docs are versioned constants; existing accounts set passwords via the reset flow.

- [ ] **Step 2: KNOWN_LIMITATIONS.md** — add under an Auth section:
  - Terms/Privacy are drafts pending legal review (versions 2026-07-19).
  - Leaked-password protection: note enabled, or plan-gated if Task 12 Step 3 was skipped.
  - A user who signs up but abandons onboarding has no username yet and must sign in with email.
  - No 2FA; no session-management UI; usernames not changeable after onboarding.

- [ ] **Step 3: CURRENT_PHASE.md** — record the slice (completed work + any follow-ups) per house convention.

- [ ] **Step 4: Full check**

Run: `pnpm check`
Expected: lint 0 errors, typecheck 0 errors, all unit tests pass, build succeeds.

- [ ] **Step 5: Visual verification** — with `pnpm dev`, screenshot at ~390px and desktop: `/login`, `/signup`, `/auth/reset`, `/auth/reset/update`, `/consent` (via an un-consented account), `/terms`, `/privacy`. Confirm: no color-only state signals, all links navigate, eye toggle works, no console errors.

- [ ] **Step 6: Commit docs**

```bash
git add docs/DECISIONS.md docs/KNOWN_LIMITATIONS.md docs/CURRENT_PHASE.md
git commit -m "docs: record password auth decision, limitations, and phase update"
```
