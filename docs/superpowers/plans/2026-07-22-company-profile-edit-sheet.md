# Company Profile Edit Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner tap the dashboard's top-left company identity block to open a bottom sheet and edit their company name, ticker, username, and pick an emblem from curated icon presets.

**Architecture:** No schema change — the already-existing `personal_companies.logo_path` column stores a tagged string (`preset:<id>` | `null`). Emblem presets are curated lucide icons (zero storage). A pure `resolveEmblem` resolver drives a presentational `CompanyEmblem`; a `CompanyProfileSheet` (react-hook-form over the reusable `Sheet` primitive) writes changes through an `updateCompanyProfile` server action. Custom image upload is deferred to the future rankings slice.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict), Tailwind 4, Zod, react-hook-form, lucide-react, Supabase, Vitest.

## Global Constraints

- **No React/Next imports in `src/lib/financial-engine` or `src/lib/demo-data`.** (`src/lib/config` and `src/lib/validation` may import libraries like lucide-react and zod — they already do.)
- **Deterministic code calculates; this slice is pure identity CRUD** — touch no financial formula.
- **Mobile-first:** design and verify at ~390px before desktop.
- **Accessible:** keyboard-navigable, visible focus, never communicate state through color alone (pair with shape/checkmark/text); preserve a page `<h1>`.
- **Ticker is stored `$`-prefixed** (`$KOAH`), matching `completeOnboarding`. The edit form shows/edits the bare ticker; the action re-adds `$`.
- **No `*.test.tsx` in this repo** — React components are verified by `pnpm typecheck` + visual QA; only framework-free modules get Vitest unit tests.
- **`pnpm check` (lint + typecheck + test + build) must be green before completion.**

---

### Task 1: Emblem presets registry + pure resolver

**Files:**
- Create: `src/lib/config/company-presets.ts`
- Test: `src/lib/config/company-presets.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface CompanyPreset { id: string; label: string; Icon: LucideIcon }`
  - `const COMPANY_PRESETS: readonly CompanyPreset[]`
  - `function isKnownPresetId(id: string): boolean`
  - `type Emblem = { kind: "preset"; preset: CompanyPreset } | { kind: "default" }`
  - `function resolveEmblem(logoPath: string | null): Emblem`

- [ ] **Step 1: Write the failing test**

Create `src/lib/config/company-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMPANY_PRESETS, isKnownPresetId, resolveEmblem } from "./company-presets";

describe("COMPANY_PRESETS", () => {
  it("has unique, kebab-case ids and populated fields", () => {
    const ids = COMPANY_PRESETS.map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of COMPANY_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.Icon).toBeTruthy();
    }
  });
});

describe("resolveEmblem", () => {
  it("resolves a known preset id", () => {
    const first = COMPANY_PRESETS[0];
    expect(resolveEmblem(`preset:${first.id}`)).toEqual({ kind: "preset", preset: first });
  });
  it("falls back to default for null", () => {
    expect(resolveEmblem(null)).toEqual({ kind: "default" });
  });
  it("falls back to default for an unknown preset id", () => {
    expect(resolveEmblem("preset:does-not-exist")).toEqual({ kind: "default" });
  });
  it("falls back to default for malformed values", () => {
    expect(resolveEmblem("upload:whatever")).toEqual({ kind: "default" });
    expect(resolveEmblem("garbage")).toEqual({ kind: "default" });
  });
});

describe("isKnownPresetId", () => {
  it("is true for a registered id and false otherwise", () => {
    expect(isKnownPresetId(COMPANY_PRESETS[0].id)).toBe(true);
    expect(isKnownPresetId("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/config/company-presets.test.ts`
Expected: FAIL — cannot resolve `./company-presets`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/config/company-presets.ts`:

```ts
import { Anchor, Mountain, Sailboat, Shell, Ship, Sun, Sunrise, Waves, type LucideIcon } from "lucide-react";

/** A curated company emblem the user can pick. Persisted as `preset:<id>`. */
export interface CompanyPreset {
  id: string;
  label: string;
  Icon: LucideIcon;
}

/**
 * Island/ocean-themed emblems matching the demo companies. Deliberately
 * excludes a palm so it never duplicates the default emblem (TreePalm), which
 * is what `logo_path === null` renders.
 */
export const COMPANY_PRESETS: readonly CompanyPreset[] = [
  { id: "waves", label: "Waves", Icon: Waves },
  { id: "mountain", label: "Mountain", Icon: Mountain },
  { id: "anchor", label: "Anchor", Icon: Anchor },
  { id: "sun", label: "Sun", Icon: Sun },
  { id: "ship", label: "Ship", Icon: Ship },
  { id: "sailboat", label: "Sailboat", Icon: Sailboat },
  { id: "sunrise", label: "Sunrise", Icon: Sunrise },
  { id: "shell", label: "Shell", Icon: Shell },
];

const PRESET_BY_ID: Record<string, CompanyPreset> = Object.fromEntries(
  COMPANY_PRESETS.map((p) => [p.id, p]),
);

export function isKnownPresetId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESET_BY_ID, id);
}

export type Emblem = { kind: "preset"; preset: CompanyPreset } | { kind: "default" };

/**
 * Turn a stored `logo_path` into a render instruction. Unknown or malformed
 * values fall back to the default emblem rather than throwing, so a preset
 * removed in a later release degrades gracefully. The `upload:*` namespace is
 * reserved for the deferred custom-upload slice and resolves to default here.
 */
export function resolveEmblem(logoPath: string | null): Emblem {
  if (logoPath && logoPath.startsWith("preset:")) {
    const preset = PRESET_BY_ID[logoPath.slice("preset:".length)];
    if (preset) return { kind: "preset", preset };
  }
  return { kind: "default" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/config/company-presets.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/company-presets.ts src/lib/config/company-presets.test.ts
git commit -m "feat(company): emblem presets registry + resolveEmblem"
```

---

### Task 2: Shared identity validation + companyProfileSchema

**Files:**
- Create: `src/lib/validation/company-profile.ts`
- Create: `src/lib/validation/company-profile.test.ts`
- Modify: `src/lib/validation/onboarding.ts` (consume the shared fields)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `companyNameField`, `tickerField`, `usernameField` (Zod schemas)
  - `companyProfileSchema` (Zod object)
  - `type CompanyProfileValues = { companyName: string; ticker: string; username: string; logoPath: string | null }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validation/company-profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { companyProfileSchema } from "./company-profile";

const valid = { companyName: "Koa Holdings", ticker: "KOAH", username: "IslandBuilder", logoPath: null };

describe("companyProfileSchema", () => {
  it("accepts a valid payload with a null emblem", () => {
    expect(companyProfileSchema.parse(valid)).toMatchObject({ ticker: "KOAH", logoPath: null });
  });
  it("uppercases the ticker", () => {
    expect(companyProfileSchema.parse({ ...valid, ticker: "koah" }).ticker).toBe("KOAH");
  });
  it("accepts a preset emblem", () => {
    expect(companyProfileSchema.parse({ ...valid, logoPath: "preset:waves" }).logoPath).toBe("preset:waves");
  });
  it("rejects a too-long ticker", () => {
    expect(() => companyProfileSchema.parse({ ...valid, ticker: "TOOLONG1" })).toThrow();
  });
  it("rejects a username with spaces", () => {
    expect(() => companyProfileSchema.parse({ ...valid, username: "island builder" })).toThrow();
  });
  it("rejects a malformed logoPath (e.g. an upload path)", () => {
    expect(() => companyProfileSchema.parse({ ...valid, logoPath: "upload:abc/def.webp" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/validation/company-profile.test.ts`
Expected: FAIL — cannot resolve `./company-profile`.

- [ ] **Step 3: Write the shared schema**

Create `src/lib/validation/company-profile.ts`:

```ts
import { z } from "zod";

// Shared identity fields — the single source of truth for company name,
// ticker, and username validation, consumed by both onboarding and the
// profile edit sheet so the two can never drift.
export const companyNameField = z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters");
export const tickerField = z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "2–5 letters");
export const usernameField = z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, "3–20 letters, numbers, underscores");

// Emblem: a `preset:<id>` tag or null (default). The `upload:*` namespace is
// reserved for the deferred custom-upload slice and is intentionally rejected
// here so this slice can never persist one.
export const logoPathField = z.string().regex(/^preset:[a-z0-9-]+$/, "Invalid emblem").nullable();

export const companyProfileSchema = z.object({
  companyName: companyNameField,
  ticker: tickerField,
  username: usernameField,
  logoPath: logoPathField,
});

export type CompanyProfileValues = z.infer<typeof companyProfileSchema>;
```

- [ ] **Step 4: Refactor onboarding to consume the shared fields**

In `src/lib/validation/onboarding.ts`, replace the inline `companyName`, `ticker`, and `username` definitions with the shared imports. The file becomes:

```ts
import { z } from "zod";
import { AGE_COHORTS, COL_CATEGORIES, HOUSEHOLD_TYPES, INCOME_BANDS, OBJECTIVES } from "@/lib/config/cohorts";
import { companyNameField, tickerField, usernameField } from "@/lib/validation/company-profile";

export const onboardingSchema = z.object({
  companyName: companyNameField,
  ticker: tickerField,
  username: usernameField,
  ageCohort: z.enum(AGE_COHORTS),
  incomeBand: z.enum(INCOME_BANDS),
  householdType: z.enum(HOUSEHOLD_TYPES),
  colCohort: z.enum(COL_CATEGORIES),
  objective: z.enum(OBJECTIVES.map((o) => o.value) as [string, ...string[]]),
  loadDemo: z.boolean(),
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;
```

- [ ] **Step 5: Run both validation test files to verify they pass**

Run: `pnpm test src/lib/validation/company-profile.test.ts src/lib/validation/onboarding.test.ts`
Expected: PASS — the new schema tests pass and the existing `onboardingSchema` tests still pass unchanged (they assert parse/throw behavior, which the shared fields preserve).

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation/company-profile.ts src/lib/validation/company-profile.test.ts src/lib/validation/onboarding.ts
git commit -m "feat(company): shared identity fields + companyProfileSchema"
```

---

### Task 3: `updateCompanyProfile` server action

**Files:**
- Create: `src/app/actions/company-profile.ts`

**Interfaces:**
- Consumes: `companyProfileSchema`, `CompanyProfileValues` (Task 2); `isKnownPresetId` (Task 1).
- Produces: `async function updateCompanyProfile(values: CompanyProfileValues): Promise<{ error?: string }>`

Note: this action talks to Supabase, so — per repo convention (see `completeOnboarding`, `updateAccount`) — it has no unit test; it is verified by `pnpm typecheck` here and by live visual QA in Task 7.

- [ ] **Step 1: Write the action**

Create `src/app/actions/company-profile.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isKnownPresetId } from "@/lib/config/company-presets";
import { companyProfileSchema, type CompanyProfileValues } from "@/lib/validation/company-profile";

export async function updateCompanyProfile(values: CompanyProfileValues): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = companyProfileSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  // logoPath shape is already validated as `preset:<id>` | null; additionally
  // reject a well-formed tag whose id isn't a real preset.
  if (v.logoPath !== null && !isKnownPresetId(v.logoPath.slice("preset:".length))) {
    return { error: "Unknown emblem" };
  }

  // Username lives on user_profiles and is unique; map the uniqueness
  // violation to a friendly message. Updating to the current (unchanged)
  // username targets the same row and cannot collide.
  const { error: profileErr } = await supabase
    .from("user_profiles")
    .update({ username: v.username })
    .eq("id", user.id);
  if (profileErr) {
    return { error: profileErr.code === "23505" ? "That username is taken." : profileErr.message };
  }

  const { error: companyErr } = await supabase
    .from("personal_companies")
    .update({ name: v.companyName, ticker: `$${v.ticker}`, logo_path: v.logoPath })
    .eq("user_id", user.id);
  if (companyErr) return { error: companyErr.message };

  revalidatePath("/");
  return {};
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/company-profile.ts
git commit -m "feat(company): updateCompanyProfile server action"
```

---

### Task 4: `CompanyEmblem` presentational component

**Files:**
- Create: `src/components/dashboard/CompanyEmblem.tsx`

**Interfaces:**
- Consumes: `resolveEmblem` (Task 1).
- Produces: `function CompanyEmblem({ logoPath, size }: { logoPath: string | null; size?: "sm" | "md" })`

- [ ] **Step 1: Write the component**

Create `src/components/dashboard/CompanyEmblem.tsx`:

```tsx
import { TreePalm } from "lucide-react";
import { resolveEmblem } from "@/lib/config/company-presets";

/**
 * The circular company emblem. Renders the chosen preset icon, or the default
 * TreePalm when logo_path is null/unknown. `md` (48px) is the header size; `sm`
 * (40px) is used inside the emblem picker.
 */
export function CompanyEmblem({ logoPath, size = "md" }: { logoPath: string | null; size?: "sm" | "md" }) {
  const emblem = resolveEmblem(logoPath);
  const Icon = emblem.kind === "preset" ? emblem.preset.Icon : TreePalm;
  const dims = size === "md" ? { box: "size-12", icon: 24 } : { box: "size-10", icon: 20 };
  return (
    <span
      aria-hidden
      className={`flex ${dims.box} shrink-0 items-center justify-center rounded-full border border-positive/50 text-positive`}
    >
      <Icon size={dims.icon} />
    </span>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/CompanyEmblem.tsx
git commit -m "feat(company): CompanyEmblem component"
```

---

### Task 5: `CompanyProfileSheet` edit sheet

**Files:**
- Create: `src/components/dashboard/CompanyProfileSheet.tsx`

**Interfaces:**
- Consumes: `Sheet` (`src/components/ui/Sheet.tsx`); `CompanyEmblem` (Task 4); `updateCompanyProfile` (Task 3); `companyProfileSchema`, `CompanyProfileValues` (Task 2); `COMPANY_PRESETS` (Task 1).
- Produces: `function CompanyProfileSheet({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: { companyName: string; ticker: string; username: string; logoPath: string | null } })`

- [ ] **Step 1: Write the component**

Create `src/components/dashboard/CompanyProfileSheet.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { CompanyEmblem } from "@/components/dashboard/CompanyEmblem";
import { updateCompanyProfile } from "@/app/actions/company-profile";
import { companyProfileSchema, type CompanyProfileValues } from "@/lib/validation/company-profile";
import { COMPANY_PRESETS } from "@/lib/config/company-presets";

const inputCls =
  "rounded-xl border border-border-subtle bg-inset px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:border-border-strong focus:outline-none";
const labelCls = "text-sm font-medium text-primary";

export function CompanyProfileSheet({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial: { companyName: string; ticker: string; username: string; logoPath: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: {
      companyName: initial.companyName,
      ticker: initial.ticker.replace(/^\$/, ""),
      username: initial.username,
      logoPath: initial.logoPath,
    },
  });
  const selected = watch("logoPath");

  const submit = (values: CompanyProfileValues) => {
    setServerError(null);
    startTransition(async () => {
      const result = await updateCompanyProfile(values);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  const choose = (logoPath: string | null) => setValue("logoPath", logoPath, { shouldDirty: true });

  return (
    <Sheet open={open} onClose={onClose} title="Edit company">
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3">
        <label className={labelCls} htmlFor="cp-name">Company name</label>
        <input id="cp-name" className={inputCls} placeholder="Koa Holdings" {...register("companyName")} />
        {errors.companyName && <p role="alert" className="text-xs text-negative">{errors.companyName.message}</p>}

        <label className={labelCls} htmlFor="cp-ticker">Ticker</label>
        <input id="cp-ticker" className={`${inputCls} uppercase`} placeholder="KOAH" maxLength={5} {...register("ticker")} />
        {errors.ticker && <p role="alert" className="text-xs text-negative">{errors.ticker.message}</p>}

        <label className={labelCls} htmlFor="cp-username">Username</label>
        <input id="cp-username" className={inputCls} placeholder="IslandBuilder" {...register("username")} />
        {errors.username && <p role="alert" className="text-xs text-negative">{errors.username.message}</p>}

        <span className={labelCls}>Emblem</span>
        <div role="radiogroup" aria-label="Company emblem" className="grid grid-cols-4 gap-2">
          <EmblemOption label="Default" logoPath={null} selected={selected == null} onSelect={() => choose(null)} />
          {COMPANY_PRESETS.map((p) => {
            const value = `preset:${p.id}`;
            return (
              <EmblemOption key={p.id} label={p.label} logoPath={value} selected={selected === value} onSelect={() => choose(value)} />
            );
          })}
        </div>

        {serverError && <p role="alert" className="text-sm text-negative">{serverError}</p>}

        <div className="mt-2 flex gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-border-subtle px-4 py-3 text-sm text-secondary">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="flex-1 rounded-xl bg-positive-strong px-4 py-3 text-sm font-semibold text-base disabled:opacity-60">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function EmblemOption({
  label,
  logoPath,
  selected,
  onSelect,
}: {
  label: string;
  logoPath: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 ${selected ? "border-positive" : "border-border-subtle"}`}
    >
      <CompanyEmblem logoPath={logoPath} size="sm" />
      {selected && <Check size={14} aria-hidden className="absolute right-1 top-1 text-positive" />}
      <span className="text-[10px] text-tertiary">{label}</span>
    </button>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/CompanyProfileSheet.tsx
git commit -m "feat(company): CompanyProfileSheet edit sheet"
```

---

### Task 6: Make the header editable + plumb logoPath through

**Files:**
- Modify: `src/components/dashboard/CompanyHeader.tsx` (client; trigger + emblem + hosts the sheet)
- Modify: `src/components/dashboard/HomeDashboard.tsx` (`DashboardIdentity` gains `logoPath`; pass it to `CompanyHeader`)
- Modify: `src/app/page.tsx` (pass `logoPath: company.logo_path`)
- Modify: `src/lib/data/queries.ts` (`CompanyRow` gains `logo_path`)

**Interfaces:**
- Consumes: `CompanyEmblem` (Task 4), `CompanyProfileSheet` (Task 5).
- Produces: `CompanyHeader` prop shape `{ companyName; ticker; username; logoPath: string | null; level? }`; `DashboardIdentity.logoPath: string | null`.

- [ ] **Step 1: Add `logo_path` to the CompanyRow type**

In `src/lib/data/queries.ts`, extend the interface (the query already uses `select("*")`, so no query change is needed):

```ts
export interface CompanyRow { id: string; user_id: string; name: string; ticker: string; logo_path: string | null; }
```

- [ ] **Step 2: Rewrite CompanyHeader as an editable client component**

Replace the entire contents of `src/components/dashboard/CompanyHeader.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { BadgeCheck, Pencil, TreePalm } from "lucide-react";
import { CompanyEmblem } from "@/components/dashboard/CompanyEmblem";
import { CompanyProfileSheet } from "@/components/dashboard/CompanyProfileSheet";

interface CompanyHeaderProps {
  companyName: string;
  ticker: string;
  username: string;
  logoPath: string | null;
  level?: number;
}

/** Personal-company identity block. The whole left block is a single button
 *  that opens the edit sheet; a visually-hidden <h1> preserves the heading
 *  outline (a heading nested inside a button would lose its heading role). */
export function CompanyHeader({ companyName, ticker, username, logoPath, level }: CompanyHeaderProps) {
  const [editing, setEditing] = useState(false);
  return (
    <header className="flex items-center justify-between">
      <h1 className="sr-only">{companyName}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit company profile"
        className="flex items-center gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
      >
        <CompanyEmblem logoPath={logoPath} />
        <span className="block">
          <span className="flex items-center gap-1.5 text-lg leading-tight font-semibold text-primary">
            {companyName}
            <Pencil size={13} aria-hidden className="text-tertiary" />
          </span>
          <span className="tabular block text-sm font-medium text-positive">{ticker}</span>
          <span className="flex items-center gap-1 text-xs text-secondary">
            {username}
            <BadgeCheck size={13} aria-hidden className="text-positive" />
          </span>
        </span>
      </button>
      {level !== undefined && (
        <span className="relative flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-positive/30 via-elevated-2 to-[color:var(--chart-waterline)]/20 text-positive">
          <TreePalm size={22} aria-hidden />
          <span className="absolute -bottom-1 rounded-full border border-border-subtle bg-elevated px-1.5 text-[9px] font-semibold text-secondary">
            LV. {level}
          </span>
          <span className="sr-only">Level {level}</span>
        </span>
      )}
      <CompanyProfileSheet
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ companyName, ticker, username, logoPath }}
      />
    </header>
  );
}
```

- [ ] **Step 3: Thread `logoPath` through HomeDashboard**

In `src/components/dashboard/HomeDashboard.tsx`, add `logoPath` to the identity type and pass it to the header.

Change the `DashboardIdentity` interface (around line 63) to include:

```ts
export interface DashboardIdentity {
  companyName: string;
  ticker: string;
  username: string;
  logoPath: string | null;
  level?: number;
}
```

Update the `<CompanyHeader .../>` render (around line 127) to pass the prop:

```tsx
      <CompanyHeader
        companyName={profile.companyName}
        ticker={profile.ticker}
        username={profile.username}
        logoPath={profile.logoPath}
        level={profile.level}
      />
```

- [ ] **Step 4: Pass `logoPath` from the page loader**

In `src/app/page.tsx`, update the `profile` prop passed to `<HomeDashboard>` to include the logo path:

```tsx
          profile={{ companyName: company.name, ticker: company.ticker, username: profile.username, level: VIEWER_LEVEL, logoPath: company.logo_path }}
```

(The `EmptyDashboard` branch is intentionally unchanged — it renders a plain `<h1>`, not the identity block, and is out of scope for editing in this slice.)

- [ ] **Step 5: Verify the whole app typechecks and builds**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — no type errors; production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/CompanyHeader.tsx src/components/dashboard/HomeDashboard.tsx src/app/page.tsx src/lib/data/queries.ts
git commit -m "feat(company): editable identity header with emblem"
```

---

### Task 7: Docs, deferral record, and final verification

**Files:**
- Modify: `docs/KNOWN_LIMITATIONS.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/CURRENT_PHASE.md`

- [ ] **Step 1: Record the deferred custom-upload work**

Append to `docs/KNOWN_LIMITATIONS.md` a new entry:

```markdown
## Company logo: custom image upload deferred to the rankings slice

The company emblem is currently a curated **icon preset** (`personal_companies.logo_path` = `preset:<id>` | null). Custom **image upload** is deferred and will land together with the rankings cross-user surface, because an uploaded logo's purpose — being seen by other users next to your ticker — does not exist until rankings ships. That slice adds: a **public-read** `company-logos` Supabase Storage bucket (owner-scoped writes via RLS, mirroring migration `0013`'s policy shape but with public reads), client-side resize-to-square (≤512px → webp) writing `logo_path` as `upload:<uid>/<file>`, the `upload` arm of `resolveEmblem` + an `<img>` render in `CompanyEmblem`, an explicit "this image is public" label in the picker, and a content-moderation / report mechanism for user-supplied images.
```

- [ ] **Step 2: Record the decision**

Append to `docs/DECISIONS.md` a new dated entry using the next sequential decision number (check the last `#N` in the file and use `N+1`):

```markdown
### #<N+1> — Editable company identity via a bottom sheet; emblem as icon presets (2026-07-22)

**Decision:** The dashboard's top-left company block is tappable, opening a bottom sheet to edit company name, ticker, username, and emblem. The emblem is stored in the existing `personal_companies.logo_path` column as a tagged string (`preset:<id>` | `null`; `upload:<path>` reserved). Presets are curated lucide icons — no storage.

**Alternatives considered:** (a) a dedicated `/profile` page — rejected in favor of the in-context sheet matching the existing `Sheet` pattern; (b) custom image upload in this slice — deferred to the rankings slice, since an uploaded logo only becomes meaningful once other users can see it, and it brings a storage bucket + public-read policy + content moderation that are premature before rankings exists; (c) a public storage bucket now — deferred with upload.

**Reasoning:** Deliver editable identity + a non-default emblem immediately with zero storage and zero moderation surface. A company logo is part of the *fictional* public identity (name, ticker, emblem) that public surfaces are explicitly allowed to show, so it does not conflict with privacy-by-design; only raw financial data stays private.

**Consequences:** `personal_companies.logo_path` is now read/written (was unused). Onboarding's name/ticker/username validation is now shared with the edit sheet via `src/lib/validation/company-profile.ts`. Custom upload, the public bucket, and moderation are recorded in KNOWN_LIMITATIONS for the rankings slice.
```

- [ ] **Step 3: Update the current-phase doc**

Prepend a short entry to the "Recently completed"/summary area of `docs/CURRENT_PHASE.md` noting: the out-of-roadmap **company profile edit sheet** slice — tap the dashboard identity block to edit name/ticker/username and pick an emblem preset; emblem stored in `personal_companies.logo_path` (`preset:<id>` | null); shared identity validation extracted; custom upload deferred to the rankings slice; branch `worktree-company-profile-edit`; DECISIONS #<N+1>.

- [ ] **Step 4: Run the full check**

Run: `pnpm check`
Expected: PASS — lint, typecheck, test, and build all green.

- [ ] **Step 5: Visual QA (manual, mobile-first)**

With `pnpm dev` running and signed in to a company that has dashboard data, verify at ~390px first, then desktop (~1280px):
1. The top-left block shows the emblem, company name (with a small pencil affordance), ticker, and username.
2. Tapping the block opens the bottom sheet; Escape and Cancel close it; focus is trapped while open and restored on close.
3. Changing the name, ticker (lowercase input is uppercased), and username and pressing **Save changes** closes the sheet and the header reflects the new values.
4. Selecting each emblem preset shows the checkmark + border (state conveyed by shape/text, not color alone), and Save updates the header emblem; selecting **Default** restores the TreePalm.
5. Entering a username already taken by another account surfaces "That username is taken." inline without closing the sheet.
6. Keyboard-only: the identity block is reachable and activatable via Tab/Enter, and the emblem options are reachable and selectable.

- [ ] **Step 6: Commit the docs**

```bash
git add docs/KNOWN_LIMITATIONS.md docs/DECISIONS.md docs/CURRENT_PHASE.md
git commit -m "docs(company): record profile-edit slice, decision, deferred upload"
```

---

## Self-Review

**Spec coverage:**
- Bottom-sheet surface → Task 5 (`CompanyProfileSheet` over `Sheet`) + Task 6 (trigger). ✓
- Edit name/ticker/username → Tasks 2, 3, 5. ✓
- Emblem presets (curated icons, no storage) → Tasks 1, 4, 5. ✓
- `logo_path` tagged string, no migration → Tasks 1, 3, 6. ✓
- Shared validation to prevent drift → Task 2. ✓
- Username uniqueness → "taken" message → Task 3. ✓
- `CompanyEmblem` pure-branch resolver → Tasks 1, 4. ✓
- Header renders emblem + is clickable, heading preserved → Task 6. ✓
- Privacy consistency (fictional identity) → documented in Task 7 decision. ✓
- Deferred upload/public bucket/moderation → Task 7 KNOWN_LIMITATIONS. ✓
- Tests: validation schema, preset registry, resolveEmblem → Tasks 1, 2. ✓
- **Spec deviation:** the spec said pass `logoPath` into "both the populated `CompanyHeader` and the `EmptyDashboard` one"; `EmptyDashboard` has no `CompanyHeader` (plain `<h1>`), so only the populated header is wired — recorded in Task 6, Step 4.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**Type consistency:** `resolveEmblem`/`Emblem`/`CompanyPreset` (Task 1) used identically in Tasks 4–5; `CompanyProfileValues` (Task 2) consumed by Tasks 3 and 5; `CompanyRow.logo_path` (Task 6) feeds `page.tsx` → `DashboardIdentity.logoPath` → `CompanyHeader.logoPath` → `CompanyProfileSheet.initial.logoPath`, all typed `string | null`. `updateCompanyProfile` returns `{ error?: string }` and the sheet reads `result.error`. ✓
