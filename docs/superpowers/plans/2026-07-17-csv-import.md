# CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users import real bank/card CSV exports into a chosen account — column mapping, preview with dedupe + transfer detection, all-or-nothing commit, batch-level undo — completing the Phase 3 remainder.

**Architecture:** Client-side parse (raw file never leaves the browser) through a new framework-free `src/lib/csv-import/` module (parse → detect → normalize → dedupe → transfers); a server action is the trust boundary (Zod validation, dedupe re-check, chunked insert under one `import_batch_id`, existing `finishWithRebuild` snapshot pipeline). Spec: `docs/superpowers/specs/2026-07-17-csv-import-design.md`.

**Tech Stack:** Next.js 16 App Router, strict TypeScript, Tailwind 4, Zod 4 (`z.uuid()` style), Vitest, Supabase (RLS), pnpm. No new dependencies (CSV parsing is hand-rolled).

## Global Constraints

- `src/lib/csv-import/` must have **no React/Next/Supabase imports** (same rule as `financial-engine`; importing types from `@/lib/config/categories` is fine — it's framework-free).
- No financial formula in React components; all import logic lives in `csv-import/` or server actions.
- Mutation actions return `MutationResult` (`error: ""` = success) from `@/lib/validation/transactions`.
- Mobile-first ~390 px; never communicate state by color alone; every non-obvious behavior gets visible explanatory copy ("Why was this skipped?").
- Loading/empty/error states on every step; no silently dropped rows.
- Raw file contents, descriptions, amounts, merchant strings never leave the browser except as validated rows to our own server action; no analytics calls in this slice.
- Category taxonomy: `CATEGORIES` from `src/lib/config/categories.ts`. Direction defaults: inflow → `income`, outflow → `other`.
- Caps: 5 MB file, 10 000 rows, description ≤ 200 chars (trimmed, whitespace-collapsed, sliced).
- Transfer pairs: opposite direction, equal amount, ±3 days, other side an existing transaction on a **different** account; recorded on the new row only (existing rows are never mutated — 0002 immutability trigger).
- Commit messages: `feat(import): …` / `fix(import): …`; end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `pnpm check` green before declaring the slice complete.

---

### Task 1: Migration `0004_csv_import`

**Files:**
- Create: `supabase/migrations/0004_csv_import.sql`

**Interfaces:**
- Produces: `transactions.import_batch_id uuid null` column; index `transactions_user_batch_idx`; `import_batch_id` added to the immutable-source trigger's protected set.

- [ ] **Step 1: Write the migration**

```sql
-- CSV import slice: per-row provenance + batch-level undo.
-- import_batch_id is set at insert for CSV-imported rows and never updated;
-- it joins the immutable source columns (corrections stay in user_override,
-- removal happens only as whole-batch undo).
alter table public.transactions
  add column import_batch_id uuid;

create index transactions_user_batch_idx
  on public.transactions (user_id, import_batch_id)
  where import_batch_id is not null;

create or replace function public.transactions_prevent_source_update()
returns trigger
language plpgsql
as $$
begin
  if (
    new.id is distinct from old.id
    or new.account_id is distinct from old.account_id
    or new.user_id is distinct from old.user_id
    or new.posted_date is distinct from old.posted_date
    or new.authorized_date is distinct from old.authorized_date
    or new.amount is distinct from old.amount
    or new.direction is distinct from old.direction
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory
    or new.txn_type is distinct from old.txn_type
    or new.recurring_status is distinct from old.recurring_status
    or new.essential is distinct from old.essential
    or new.is_transfer is distinct from old.is_transfer
    or new.transfer_pair_id is distinct from old.transfer_pair_id
    or new.confidence is distinct from old.confidence
    or new.created_at is distinct from old.created_at
    or new.import_batch_id is distinct from old.import_batch_id
  ) then
    raise exception 'transactions: source columns are immutable after insert; corrections must go in user_override';
  end if;

  return new;
end;
$$;
```

- [ ] **Step 2: Apply to the linked project**

Run: `supabase db push`
Expected: `Applying migration 0004_csv_import.sql... Finished supabase db push.` (accept the confirmation prompt).

- [ ] **Step 3: Verify the trigger still guards + new column immutable**

Run: `pnpm test:rls`
Expected: 15/15 existing checks still pass (Task 16 adds new ones).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_csv_import.sql
git commit -m "feat(import): migration 0004 — transactions.import_batch_id + immutability"
```

---

### Task 2: `csv-import` types + parser

**Files:**
- Create: `src/lib/csv-import/types.ts`
- Create: `src/lib/csv-import/parse.ts`
- Test: `src/lib/csv-import/parse.test.ts`

**Interfaces:**
- Produces (types.ts, used by every later task):

```ts
import type { Category } from "@/lib/config/categories";

export interface ParseError { line: number; message: string; }

export interface ParsedCsv {
  headers: string[];
  /** Data rows only (header excluded). Short rows are padded with "".
   * `line` is the 1-based source line (header = line 1), preserved across
   * skipped blank/overlong rows so row identity stays exact. */
  rows: Array<{ line: number; cells: string[] }>;
  errors: ParseError[];
}

export type DateFormat = "mdy" | "dmy" | "ymd";
/** For a single signed amount column: which sign means money in. */
export type SignConvention = "positive_inflow" | "positive_outflow";

export interface ColumnMapping {
  /** Column indexes into ParsedCsv.headers; -1 = not chosen yet. */
  date: number;
  description: number;
  /** Single signed amount column, or -1 when using a debit/credit pair. */
  amount: number;
  debit: number;
  credit: number;
  category: number;
  dateFormat: DateFormat;
  signConvention: SignConvention;
  /** Case-folded bank category value -> PFI category. */
  categoryValues: Record<string, Category>;
}

export interface MappingProposal {
  mapping: ColumnMapping;
  detected: { date: boolean; description: boolean; amount: boolean; category: boolean };
}

export interface NormalizedRow {
  /** 1-based source line (header = line 1). Stable row identity across steps. */
  line: number;
  postedDate: string; // ISO yyyy-mm-dd
  amount: number;     // > 0, ≤ 2 decimals
  direction: "inflow" | "outflow";
  description: string;
  category: Category;
}
export interface RowError { line: number; message: string; }
export interface NormalizeResult { rows: NormalizedRow[]; errors: RowError[]; }

/** Existing-transaction shape (source values) for dedupe/transfer detection. */
export interface ExistingTxn {
  id: string;
  accountId: string;
  postedDate: string;
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
  isTransfer: boolean;
  transferPairId: string | null;
}

export interface DedupeResult { fresh: NormalizedRow[]; duplicates: NormalizedRow[]; }

/** Proposed pair: a batch row (line) + an existing txn on another account. */
export interface TransferPair { line: number; existingId: string; }
```

- Produces (parse.ts): `parseCsv(text: string): ParsedCsv`

- [ ] **Step 1: Write types.ts exactly as above** (no test — types only).

- [ ] **Step 2: Write the failing parser tests**

```ts
// src/lib/csv-import/parse.test.ts
import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";

const cells = (r: ReturnType<typeof parseCsv>) => r.rows.map((x) => x.cells);

describe("parseCsv", () => {
  it("parses a simple comma CSV with line numbers", () => {
    const r = parseCsv("Date,Description,Amount\n2026-01-02,COFFEE,-4.50\n");
    expect(r.headers).toEqual(["Date", "Description", "Amount"]);
    expect(r.rows).toEqual([{ line: 2, cells: ["2026-01-02", "COFFEE", "-4.50"] }]);
    expect(r.errors).toEqual([]);
  });

  it("handles quoted fields with embedded delimiters, escaped quotes, and newlines", () => {
    const r = parseCsv('a,b\n"x, y","he said ""hi""\nnext"\n');
    expect(cells(r)).toEqual([['x, y', 'he said "hi"\nnext']]);
  });

  it("strips a BOM and handles CRLF", () => {
    const r = parseCsv("\uFEFF" + "a,b\r\n1,2\r\n");
    expect(r.headers).toEqual(["a", "b"]);
    expect(cells(r)).toEqual([["1", "2"]]);
  });

  it("sniffs semicolon and tab delimiters", () => {
    expect(cells(parseCsv("a;b\n1;2\n"))).toEqual([["1", "2"]]);
    expect(cells(parseCsv("a\tb\n1\t2\n"))).toEqual([["1", "2"]]);
  });

  it("pads short rows and rejects long rows with a line-numbered error", () => {
    const r = parseCsv("a,b,c\n1,2\n1,2,3,4\n");
    expect(r.rows).toEqual([{ line: 2, cells: ["1", "2", ""] }]);
    expect(r.errors).toEqual([{ line: 3, message: "Row has more columns than the header" }]);
  });

  it("skips blank lines but keeps original line numbers", () => {
    expect(parseCsv("a,b\n\n1,2\n\n").rows).toEqual([{ line: 3, cells: ["1", "2"] }]);
    const empty = parseCsv("");
    expect(empty.headers).toEqual([]);
    expect(empty.errors).toEqual([{ line: 1, message: "File is empty" }]);
  });

  it("reports an unclosed quote", () => {
    const r = parseCsv('a,b\n"unclosed,2\n');
    expect(r.errors.some((e) => e.message === "Unclosed quote in file")).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/lib/csv-import/parse.test.ts`
Expected: FAIL — `Cannot find module './parse'`.

- [ ] **Step 4: Implement parse.ts**

```ts
// src/lib/csv-import/parse.ts
import type { ParsedCsv, ParseError } from "./types";

const DELIMITERS = [",", ";", "\t"] as const;

function sniffDelimiter(firstLine: string): string {
  let best = ",", bestCount = -1;
  for (const d of DELIMITERS) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

/** RFC-4180-ish: quoted fields (embedded delimiters/quotes/newlines), BOM,
 * CRLF, delimiter sniffing, blank-line skipping, ragged-row tolerance. */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  if (src.trim() === "") {
    return { headers: [], rows: [], errors: [{ line: 1, message: "File is empty" }] };
  }
  const delimiter = sniffDelimiter(src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n")));

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else field += c;
  }
  const errors: ParseError[] = [];
  if (inQuotes) errors.push({ line: records.length + 1, message: "Unclosed quote in file" });
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }

  // Drop entirely-blank records but keep original line numbers.
  const numbered = records
    .map((cells, idx) => ({ cells, line: idx + 1 }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (numbered.length === 0) {
    return { headers: [], rows: [], errors: [{ line: 1, message: "File is empty" }] };
  }

  const headers = numbered[0].cells.map((h) => h.trim());
  const rows: ParsedCsv["rows"] = [];
  for (const { cells, line } of numbered.slice(1)) {
    if (cells.length > headers.length) {
      errors.push({ line, message: "Row has more columns than the header" });
      continue;
    }
    rows.push({ line, cells: [...cells, ...Array(headers.length - cells.length).fill("")] });
  }
  return { headers, rows, errors };
}
```

(`rows` carries `{ line, cells }` — original source line numbers survive skipped blank/overlong rows, so preview/error messages always point at the real line in the user's file. Every later task consumes `row.line`/`row.cells`.)

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm vitest run src/lib/csv-import/parse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv-import/types.ts src/lib/csv-import/parse.ts src/lib/csv-import/parse.test.ts
git commit -m "feat(import): csv-import types + RFC-4180-ish parser"
```

---

### Task 3: Header/format auto-detection (`detect.ts`)

**Files:**
- Create: `src/lib/csv-import/detect.ts`
- Test: `src/lib/csv-import/detect.test.ts`

**Interfaces:**
- Consumes: `ParsedCsv`, `ColumnMapping`, `MappingProposal`, `DateFormat` from `./types`.
- Produces: `proposeMapping(parsed: ParsedCsv): MappingProposal` and `inferDateFormat(samples: string[]): DateFormat`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/csv-import/detect.test.ts
import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";
import { inferDateFormat, proposeMapping } from "./detect";

describe("proposeMapping", () => {
  it("detects a Chase-style export (Posting Date / Description / Amount)", () => {
    const p = parseCsv("Details,Posting Date,Description,Amount,Type,Balance\nDEBIT,07/01/2026,COFFEE SHOP,-4.50,DEBIT,100.00\n");
    const { mapping, detected } = proposeMapping(p);
    expect(mapping.date).toBe(1);
    expect(mapping.description).toBe(2);
    expect(mapping.amount).toBe(3);
    expect(mapping.debit).toBe(-1);
    expect(detected).toEqual({ date: true, description: true, amount: true, category: false });
  });

  it("detects a debit/credit pair export", () => {
    const p = parseCsv("Date,Payee,Debit,Credit\n01/07/2026,SHOP,4.50,\n");
    const { mapping } = proposeMapping(p);
    expect(mapping.amount).toBe(-1);
    expect(mapping.debit).toBe(2);
    expect(mapping.credit).toBe(3);
  });

  it("detects a category column and leaves unknown layouts undetected", () => {
    const p = parseCsv("Transaction Date,Merchant,Amount,Category\n2026-07-01,SHOP,-1.00,Food\n");
    expect(proposeMapping(p).mapping.category).toBe(3);
    const weird = parseCsv("col1,col2\nx,y\n");
    const { mapping, detected } = proposeMapping(weird);
    expect(mapping.date).toBe(-1);
    expect(detected.date).toBe(false);
  });
});

describe("inferDateFormat", () => {
  it("recognizes ISO as ymd", () => {
    expect(inferDateFormat(["2026-07-01", "2026-07-02"])).toBe("ymd");
  });
  it("uses a >12 first component to pick dmy", () => {
    expect(inferDateFormat(["13/07/2026", "01/07/2026"])).toBe("dmy");
  });
  it("uses a >12 second component to pick mdy, and defaults ambiguous to mdy", () => {
    expect(inferDateFormat(["07/13/2026"])).toBe("mdy");
    expect(inferDateFormat(["01/02/2026"])).toBe("mdy");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/csv-import/detect.test.ts`
Expected: FAIL — `Cannot find module './detect'`.

- [ ] **Step 3: Implement detect.ts**

```ts
// src/lib/csv-import/detect.ts
import type { DateFormat, MappingProposal, ParsedCsv } from "./types";

const DATE_RX = /^(date|posted[ _-]?date|posting[ _-]?date|post[ _-]?date|transaction[ _-]?date|trans[ _-]?date)$/;
const DESC_RX = /(description|payee|memo|merchant|details|name)/;
const AMOUNT_RX = /^(amount|transaction[ _-]?amount|amount[ _-]?\(usd\))$/;
const DEBIT_RX = /(debit|withdrawal)/;
const CREDIT_RX = /(credit|deposit)/;
const CATEGORY_RX = /category/;

const fold = (h: string) => h.trim().toLowerCase();
const findIdx = (headers: string[], rx: RegExp) => headers.findIndex((h) => rx.test(fold(h)));

/** Infer how ambiguous slash/dash dates should be read from sample values. */
export function inferDateFormat(samples: string[]): DateFormat {
  for (const raw of samples) {
    const parts = raw.trim().split(/[/\-.]/);
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) return "ymd";
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (first > 12) return "dmy";
    if (second > 12) return "mdy";
  }
  return "mdy";
}

/** Propose a column mapping from common bank header names + sample values.
 * Proposals only — the user confirms every field in the mapping step. */
export function proposeMapping(parsed: ParsedCsv): MappingProposal {
  const { headers, rows } = parsed;
  const date = findIdx(headers, DATE_RX);
  const description = findIdx(headers, DESC_RX);
  const amount = findIdx(headers, AMOUNT_RX);
  // Only propose a debit/credit pair when no single amount column exists.
  const debit = amount === -1 ? findIdx(headers, DEBIT_RX) : -1;
  const credit = amount === -1 ? findIdx(headers, CREDIT_RX) : -1;
  const category = findIdx(headers, CATEGORY_RX);

  const dateSamples = date === -1 ? [] : rows.slice(0, 25).map((r) => r.cells[date] ?? "");
  return {
    mapping: {
      date, description, amount, debit, credit, category,
      dateFormat: inferDateFormat(dateSamples),
      signConvention: "positive_inflow",
      categoryValues: {},
    },
    detected: {
      date: date !== -1,
      description: description !== -1,
      amount: amount !== -1 || (debit !== -1 && credit !== -1),
      category: category !== -1,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/csv-import/detect.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv-import/detect.ts src/lib/csv-import/detect.test.ts
git commit -m "feat(import): header + date-format auto-detection"
```

---

### Task 4: Normalization (`normalize.ts`)

**Files:**
- Create: `src/lib/csv-import/normalize.ts`
- Test: `src/lib/csv-import/normalize.test.ts`

**Interfaces:**
- Consumes: `ParsedCsv`, `ColumnMapping`, `NormalizeResult`, `NormalizedRow`, `RowError` from `./types`; `Category` from `@/lib/config/categories`.
- Produces:
  - `normalizeRows(parsed: ParsedCsv, mapping: ColumnMapping): NormalizeResult`
  - `parseDateToken(raw: string, format: DateFormat): string | null`
  - `parseAmountToken(raw: string): number | null` (signed; `null` = unparseable)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/csv-import/normalize.test.ts
import { describe, expect, it } from "vitest";
import type { ColumnMapping } from "./types";
import { normalizeRows, parseAmountToken, parseDateToken } from "./normalize";
import { parseCsv } from "./parse";

const base: ColumnMapping = {
  date: 0, description: 1, amount: 2, debit: -1, credit: -1, category: -1,
  dateFormat: "mdy", signConvention: "positive_inflow", categoryValues: {},
};

describe("parseDateToken", () => {
  it("reads the ambiguous 03/04/2025 both ways", () => {
    expect(parseDateToken("03/04/2025", "mdy")).toBe("2025-03-04");
    expect(parseDateToken("03/04/2025", "dmy")).toBe("2025-04-03");
  });
  it("handles ymd, 2-digit years, and rejects garbage/invalid dates", () => {
    expect(parseDateToken("2026-07-01", "ymd")).toBe("2026-07-01");
    expect(parseDateToken("7/1/26", "mdy")).toBe("2026-07-01");
    expect(parseDateToken("02/30/2026", "mdy")).toBeNull();
    expect(parseDateToken("hello", "mdy")).toBeNull();
  });
});

describe("parseAmountToken", () => {
  it("handles currency symbols, thousands separators, parens-negative, signs", () => {
    expect(parseAmountToken("$1,234.56")).toBe(1234.56);
    expect(parseAmountToken("(45.00)")).toBe(-45);
    expect(parseAmountToken("-12.30")).toBe(-12.3);
    expect(parseAmountToken("+7")).toBe(7);
    expect(parseAmountToken("abc")).toBeNull();
    expect(parseAmountToken("")).toBeNull();
  });
});

describe("normalizeRows", () => {
  it("normalizes signed amounts with direction defaults for category", () => {
    const p = parseCsv("Date,Desc,Amount\n07/01/2026,PAYCHECK,1000\n07/02/2026,COFFEE,-4.50\n");
    const r = normalizeRows(p, base);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, postedDate: "2026-07-01", amount: 1000, direction: "inflow", description: "PAYCHECK", category: "income" },
      { line: 3, postedDate: "2026-07-02", amount: 4.5, direction: "outflow", description: "COFFEE", category: "other" },
    ]);
  });

  it("respects positive_outflow sign convention", () => {
    const p = parseCsv("Date,Desc,Amount\n07/01/2026,CHARGE,4.50\n");
    const r = normalizeRows(p, { ...base, signConvention: "positive_outflow" });
    expect(r.rows[0].direction).toBe("outflow");
  });

  it("handles debit/credit pairs and rejects both-empty and both-filled", () => {
    const p = parseCsv("Date,Desc,Debit,Credit\n07/01/2026,SHOP,4.50,\n07/02/2026,DEPOSIT,,20\n07/03/2026,BAD,,\n07/04/2026,BAD2,1,2\n");
    const m = { ...base, amount: -1, debit: 2, credit: 3 };
    const r = normalizeRows(p, m);
    expect(r.rows.map((x) => [x.direction, x.amount])).toEqual([["outflow", 4.5], ["inflow", 20]]);
    expect(r.errors.map((e) => e.line)).toEqual([4, 5]);
  });

  it("maps bank categories via categoryValues with direction fallback", () => {
    const p = parseCsv("Date,Desc,Amount,Category\n07/01/2026,SHOP,-1,Food & Drink\n07/02/2026,X,-1,Mystery\n");
    const m = { ...base, category: 3, categoryValues: { "food & drink": "groceries" as const } };
    const r = normalizeRows(p, m);
    expect(r.rows[0].category).toBe("groceries");
    expect(r.rows[1].category).toBe("other");
  });

  it("collects per-row errors without aborting: bad date, bad amount, zero amount, empty description", () => {
    const p = parseCsv("Date,Desc,Amount\nnope,X,5\n07/01/2026,,5\n07/02/2026,Y,zzz\n07/03/2026,Z,0\n07/04/2026,OK,1\n");
    const r = normalizeRows(p, base);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description).toBe("OK");
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });

  it("collapses whitespace and caps description at 200 chars", () => {
    const p = parseCsv(`Date,Desc,Amount\n07/01/2026,"A   B${"x".repeat(300)}",1\n`);
    const r = normalizeRows(p, base);
    expect(r.rows[0].description.startsWith("A B")).toBe(true);
    expect(r.rows[0].description.length).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/csv-import/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 3: Implement normalize.ts**

```ts
// src/lib/csv-import/normalize.ts
import type { Category } from "@/lib/config/categories";
import type { ColumnMapping, DateFormat, NormalizeResult, NormalizedRow, ParsedCsv, RowError } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function parseDateToken(raw: string, format: DateFormat): string | null {
  const parts = raw.trim().split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  let y: number, m: number, d: number;
  if (format === "ymd") [y, m, d] = nums;
  else if (format === "dmy") [d, m, y] = nums;
  else [m, d, y] = nums;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  // Reject impossible dates (e.g. Feb 30) via UTC round-trip.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Signed numeric amount from bank-export syntax; null when unparseable. */
export function parseAmountToken(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { negative = true; s = paren[1]; }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[$€£\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

const cleanDescription = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 200);

/** Apply a confirmed mapping to parsed rows. Per-row errors are collected,
 * never thrown, and errored rows are excluded from the result — the preview
 * lists them with reasons (no silent drops). */
export function normalizeRows(parsed: ParsedCsv, mapping: ColumnMapping): NormalizeResult {
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  const cell = (cells: string[], idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : "");

  for (const { line, cells } of parsed.rows) {
    const postedDate = parseDateToken(cell(cells, mapping.date), mapping.dateFormat);
    if (!postedDate) {
      errors.push({ line, message: `Unrecognized date "${cell(cells, mapping.date)}"` });
      continue;
    }
    const description = cleanDescription(cell(cells, mapping.description));
    if (description === "") {
      errors.push({ line, message: "Description is empty" });
      continue;
    }

    let amount: number, direction: "inflow" | "outflow";
    if (mapping.amount !== -1) {
      const signed = parseAmountToken(cell(cells, mapping.amount));
      if (signed === null) {
        errors.push({ line, message: `Unrecognized amount "${cell(cells, mapping.amount)}"` });
        continue;
      }
      if (signed === 0) { errors.push({ line, message: "Amount is zero" }); continue; }
      const positiveIn = mapping.signConvention === "positive_inflow";
      direction = signed > 0 === positiveIn ? "inflow" : "outflow";
      amount = Math.abs(signed);
    } else {
      const debitRaw = cell(cells, mapping.debit).trim();
      const creditRaw = cell(cells, mapping.credit).trim();
      const debit = debitRaw === "" ? null : parseAmountToken(debitRaw);
      const credit = creditRaw === "" ? null : parseAmountToken(creditRaw);
      const hasDebit = debit !== null && debit !== 0;
      const hasCredit = credit !== null && credit !== 0;
      if (hasDebit === hasCredit) {
        errors.push({ line, message: "Expected exactly one of debit or credit" });
        continue;
      }
      direction = hasDebit ? "outflow" : "inflow";
      amount = Math.abs(hasDebit ? debit! : credit!);
    }

    let category: Category = direction === "inflow" ? "income" : "other";
    if (mapping.category !== -1) {
      const mapped = mapping.categoryValues[cell(cells, mapping.category).trim().toLowerCase()];
      if (mapped) category = mapped;
    }

    rows.push({ line, postedDate, amount, direction, description, category });
  }
  return { rows, errors };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/csv-import/normalize.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv-import/normalize.ts src/lib/csv-import/normalize.test.ts
git commit -m "feat(import): mapping-driven row normalization"
```

---

### Task 5: Dedupe (`dedupe.ts`)

**Files:**
- Create: `src/lib/csv-import/dedupe.ts`
- Test: `src/lib/csv-import/dedupe.test.ts`

**Interfaces:**
- Consumes: `NormalizedRow`, `ExistingTxn`, `DedupeResult` from `./types`.
- Produces:
  - `dedupeKey(accountId: string, t: { postedDate: string; amount: number; direction: string; description: string }): string`
  - `markDuplicates(rows: NormalizedRow[], accountId: string, existing: ExistingTxn[]): DedupeResult` — duplicates against the target account's existing transactions **and** earlier rows in the same file.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/csv-import/dedupe.test.ts
import { describe, expect, it } from "vitest";
import type { ExistingTxn, NormalizedRow } from "./types";
import { dedupeKey, markDuplicates } from "./dedupe";

const row = (line: number, over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line, postedDate: "2026-07-01", amount: 10, direction: "outflow",
  description: "Coffee Shop", category: "other", ...over,
});
const existing = (over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id: "e1", accountId: "acct-1", postedDate: "2026-07-01", amount: 10,
  direction: "outflow", description: "COFFEE   shop", isTransfer: false,
  transferPairId: null, ...over,
});

describe("dedupeKey", () => {
  it("case-folds and collapses whitespace in descriptions", () => {
    expect(dedupeKey("a", row(2))).toBe(dedupeKey("a", row(3, { description: "  coffee   SHOP " })));
  });
});

describe("markDuplicates", () => {
  it("skips rows matching existing transactions on the same account only", () => {
    const r = markDuplicates([row(2)], "acct-1", [existing()]);
    expect(r.fresh).toEqual([]);
    expect(r.duplicates.map((d) => d.line)).toEqual([2]);
    // Same values on a different account are not duplicates.
    expect(markDuplicates([row(2)], "acct-2", [existing()]).fresh).toHaveLength(1);
  });

  it("detects intra-file duplicates, keeping the first occurrence", () => {
    const r = markDuplicates([row(2), row(3)], "acct-1", []);
    expect(r.fresh.map((d) => d.line)).toEqual([2]);
    expect(r.duplicates.map((d) => d.line)).toEqual([3]);
  });

  it("near-misses are not duplicates (one cent / one day / direction)", () => {
    const r = markDuplicates(
      [row(2, { amount: 10.01 }), row(3, { postedDate: "2026-07-02" }), row(4, { direction: "inflow" })],
      "acct-1",
      [existing()],
    );
    expect(r.fresh).toHaveLength(3);
    expect(r.duplicates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/csv-import/dedupe.test.ts`
Expected: FAIL — `Cannot find module './dedupe'`.

- [ ] **Step 3: Implement dedupe.ts**

```ts
// src/lib/csv-import/dedupe.ts
import type { DedupeResult, ExistingTxn, NormalizedRow } from "./types";

const foldDescription = (d: string) => d.trim().toLowerCase().replace(/\s+/g, " ");

/** Canonical duplicate identity: account + date + amount + direction + folded description. */
export function dedupeKey(
  accountId: string,
  t: { postedDate: string; amount: number; direction: string; description: string },
): string {
  return [accountId, t.postedDate, t.amount.toFixed(2), t.direction, foldDescription(t.description)].join("|");
}

/** Split rows into fresh vs duplicates (vs the target account's existing
 * transactions and vs earlier rows in the same file). Duplicates are
 * reported, never silently dropped — the preview lists them. */
export function markDuplicates(
  rows: NormalizedRow[],
  accountId: string,
  existing: ExistingTxn[],
): DedupeResult {
  const seen = new Set(
    existing.filter((t) => t.accountId === accountId).map((t) => dedupeKey(accountId, t)),
  );
  const fresh: NormalizedRow[] = [];
  const duplicates: NormalizedRow[] = [];
  for (const r of rows) {
    const key = dedupeKey(accountId, r);
    if (seen.has(key)) duplicates.push(r);
    else { seen.add(key); fresh.push(r); }
  }
  return { fresh, duplicates };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/csv-import/dedupe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv-import/dedupe.ts src/lib/csv-import/dedupe.test.ts
git commit -m "feat(import): exact-match dedupe against existing and intra-file rows"
```

---

### Task 6: Transfer detection (`transfers.ts`)

**Files:**
- Create: `src/lib/csv-import/transfers.ts`
- Test: `src/lib/csv-import/transfers.test.ts`

**Interfaces:**
- Consumes: `NormalizedRow`, `ExistingTxn`, `TransferPair` from `./types`.
- Produces:
  - `TRANSFER_MAX_DAY_GAP = 3` (exported const)
  - `dayGap(a: string, b: string): number` (absolute whole-day difference of ISO dates, UTC)
  - `detectTransfers(rows: NormalizedRow[], targetAccountId: string, existing: ExistingTxn[]): TransferPair[]` — candidates are existing transactions on **other** accounts with no `transferPairId`, opposite direction, equal amount, gap ≤ 3 days; greedy nearest-date; each row and each existing txn in at most one pair; deterministic (ties broken by smaller gap, then existing `id` ascending).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/csv-import/transfers.test.ts
import { describe, expect, it } from "vitest";
import type { ExistingTxn, NormalizedRow } from "./types";
import { dayGap, detectTransfers } from "./transfers";

const row = (line: number, over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line, postedDate: "2026-07-10", amount: 500, direction: "outflow",
  description: "TRANSFER TO SAVINGS", category: "other", ...over,
});
const ex = (id: string, over: Partial<ExistingTxn> = {}): ExistingTxn => ({
  id, accountId: "savings", postedDate: "2026-07-11", amount: 500,
  direction: "inflow", description: "TRANSFER FROM CHECKING", isTransfer: false,
  transferPairId: null, ...over,
});

describe("dayGap", () => {
  it("computes absolute whole-day gaps", () => {
    expect(dayGap("2026-07-10", "2026-07-13")).toBe(3);
    expect(dayGap("2026-07-13", "2026-07-10")).toBe(3);
  });
});

describe("detectTransfers", () => {
  it("pairs an imported row with an opposite existing txn on another account", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1")])).toEqual([{ line: 2, existingId: "e1" }]);
  });

  it("respects the ±3 day boundary (3 ok, 4 not)", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1", { postedDate: "2026-07-13" })])).toHaveLength(1);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { postedDate: "2026-07-14" })])).toHaveLength(0);
  });

  it("never pairs same-account, same-direction, unequal-amount, or already-paired candidates", () => {
    expect(detectTransfers([row(2)], "checking", [ex("e1", { accountId: "checking" })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { direction: "outflow" })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { amount: 499 })])).toHaveLength(0);
    expect(detectTransfers([row(2)], "checking", [ex("e1", { transferPairId: "other" })])).toHaveLength(0);
  });

  it("uses each existing txn at most once, preferring the nearest date then id", () => {
    const pairs = detectTransfers(
      [row(2, { postedDate: "2026-07-11" }), row(3, { postedDate: "2026-07-09" })],
      "checking",
      [ex("e1", { postedDate: "2026-07-11" }), ex("e2", { postedDate: "2026-07-09" })],
    );
    expect(pairs).toEqual([{ line: 2, existingId: "e1" }, { line: 3, existingId: "e2" }]);
    // Two rows, one candidate: only one pair.
    expect(detectTransfers([row(2), row(3)], "checking", [ex("e1")])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/csv-import/transfers.test.ts`
Expected: FAIL — `Cannot find module './transfers'`.

- [ ] **Step 3: Implement transfers.ts**

```ts
// src/lib/csv-import/transfers.ts
import type { ExistingTxn, NormalizedRow, TransferPair } from "./types";

export const TRANSFER_MAX_DAY_GAP = 3;
const MS_PER_DAY = 86_400_000;

export function dayGap(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY);
}

/** Conservative transfer pairing. A batch is always a single account's CSV,
 * so the other side is always an existing transaction on a different account
 * (importing the counterpart account's CSV later pairs against this batch via
 * this same path). Pairs are recorded on the new row only — existing rows are
 * never mutated (source-column immutability). */
export function detectTransfers(
  rows: NormalizedRow[],
  targetAccountId: string,
  existing: ExistingTxn[],
): TransferPair[] {
  const candidates = existing.filter(
    (t) => t.accountId !== targetAccountId && t.transferPairId === null,
  );
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const r of [...rows].sort((a, b) => a.line - b.line)) {
    const match = candidates
      .filter(
        (t) =>
          !used.has(t.id) &&
          t.direction !== r.direction &&
          t.amount === r.amount &&
          dayGap(t.postedDate, r.postedDate) <= TRANSFER_MAX_DAY_GAP,
      )
      .sort(
        (x, y) =>
          dayGap(x.postedDate, r.postedDate) - dayGap(y.postedDate, r.postedDate) ||
          (x.id < y.id ? -1 : 1),
      )[0];
    if (match) {
      used.add(match.id);
      pairs.push({ line: r.line, existingId: match.id });
    }
  }
  return pairs;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/csv-import/transfers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the whole module suite + commit**

Run: `pnpm vitest run src/lib/csv-import`
Expected: all csv-import tests pass.

```bash
git add src/lib/csv-import/transfers.ts src/lib/csv-import/transfers.test.ts
git commit -m "feat(import): conservative cross-account transfer detection"
```

---

### Task 7: Import validation schemas

**Files:**
- Create: `src/lib/validation/imports.ts`
- Test: `src/lib/validation/imports.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES` from `@/lib/config/categories`.
- Produces:

```ts
export const importTransactionsSchema: z.ZodType<...>;
export type ImportTransactionsInput = z.infer<typeof importTransactionsSchema>;
// Shape: { accountId: string; rows: Array<{ line: number; postedDate: string; amount: number;
//          direction: "inflow"|"outflow"; description: string; category: Category }>;
//          transferPairs: Array<{ line: number; existingId: string }> }
export interface ImportResult { error: string; warning?: string; batchId?: string; imported?: number; skippedDuplicates?: number; }
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/validation/imports.test.ts
import { describe, expect, it } from "vitest";
import { importTransactionsSchema } from "./imports";

const validRow = {
  line: 2, postedDate: "2026-07-01", amount: 4.5,
  direction: "outflow" as const, description: "COFFEE", category: "other" as const,
};
const valid = {
  accountId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  rows: [validRow],
  transferPairs: [],
};

describe("importTransactionsSchema", () => {
  it("accepts a valid payload", () => {
    expect(importTransactionsSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects empty rows, >10000 rows, and bad uuids", () => {
    expect(importTransactionsSchema.safeParse({ ...valid, rows: [] }).success).toBe(false);
    expect(
      importTransactionsSchema.safeParse({
        ...valid,
        rows: Array.from({ length: 10_001 }, (_, i) => ({ ...validRow, line: i + 2 })),
      }).success,
    ).toBe(false);
    expect(importTransactionsSchema.safeParse({ ...valid, accountId: "nope" }).success).toBe(false);
  });
  it("rejects bad rows: future date, negative amount, >2 decimals, unknown category, long description", () => {
    const bad = (over: object) =>
      importTransactionsSchema.safeParse({ ...valid, rows: [{ ...validRow, ...over }] }).success;
    expect(bad({ postedDate: "2999-01-01" })).toBe(false);
    expect(bad({ amount: -1 })).toBe(false);
    expect(bad({ amount: 1.999 })).toBe(false);
    expect(bad({ category: "snacks" })).toBe(false);
    expect(bad({ description: "x".repeat(201) })).toBe(false);
  });
  it("rejects malformed transfer pairs", () => {
    expect(
      importTransactionsSchema.safeParse({
        ...valid,
        transferPairs: [{ line: 2, existingId: "not-a-uuid" }],
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/validation/imports.test.ts`
Expected: FAIL — `Cannot find module './imports'`.

- [ ] **Step 3: Implement imports.ts**

```ts
// src/lib/validation/imports.ts
import { z } from "zod";
import { CATEGORIES } from "@/lib/config/categories";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const notFuture = (d: string) => d <= new Date().toISOString().slice(0, 10);

const importRowSchema = z.object({
  line: z.number().int().min(2),
  postedDate: isoDate.refine(notFuture, "Date can't be in the future"),
  amount: z
    .number()
    .positive()
    .max(10_000_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Amounts use at most 2 decimals"),
  direction: z.enum(["inflow", "outflow"]),
  description: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES),
});

export const importTransactionsSchema = z.object({
  accountId: z.uuid(),
  rows: z.array(importRowSchema).min(1, "Nothing to import").max(10_000, "Too many rows (max 10,000)"),
  transferPairs: z.array(z.object({ line: z.number().int().min(2), existingId: z.uuid() })).max(2_000),
});
export type ImportTransactionsInput = z.infer<typeof importTransactionsSchema>;

/** MutationResult + server-confirmed batch facts for the summary screen. */
export interface ImportResult {
  error: string;
  warning?: string;
  batchId?: string;
  imported?: number;
  skippedDuplicates?: number;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/validation/imports.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/imports.ts src/lib/validation/imports.test.ts
git commit -m "feat(import): Zod schemas for import payloads"
```

---

### Task 8: Data layer — batch exposure + import queries

**Files:**
- Modify: `src/lib/data/mappers.ts` (TransactionListRow/Item + `import_batch_id`; new `RecentImport`)
- Modify: `src/lib/data/queries.ts` (`getTransactionsData` select; new `getImportContext`, `getRecentImports`)
- Modify: `src/lib/data/finish-mutation.ts` (revalidate `/import`)
- Test: `src/lib/data/mappers.test.ts` (extend)

**Interfaces:**
- Consumes: `ExistingTxn` from `@/lib/csv-import/types`; `AccountSummary`, existing mapper patterns.
- Produces:
  - `TransactionListItem.importBatchId: string | null` (and `TransactionListRow.import_batch_id: string | null`)
  - `interface RecentImport { batchId: string; accountName: string; rowCount: number; firstDate: string; lastDate: string; importedAt: string; }` (in `mappers.ts`)
  - `getImportContext(supabase): Promise<{ accounts: AccountSummary[]; existing: ExistingTxn[] }>` — accounts: non-demo, non-archived; existing: all the user's transactions as `ExistingTxn` (source values).
  - `getRecentImports(supabase): Promise<RecentImport[]>` — newest first.

- [ ] **Step 1: Extend the mapper test** (in `src/lib/data/mappers.test.ts`, add to the existing describe blocks)

```ts
// Append inside the existing rowToTransactionListItem tests, reusing that
// file's existing base-row fixture (add import_batch_id to the fixture):
it("passes import_batch_id through as importBatchId", () => {
  const withBatch = { ...baseListRow, import_batch_id: "11111111-2222-4333-8444-555555555555" };
  expect(rowToTransactionListItem(withBatch).importBatchId).toBe("11111111-2222-4333-8444-555555555555");
  expect(rowToTransactionListItem({ ...baseListRow, import_batch_id: null }).importBatchId).toBeNull();
});
```

(`baseListRow` is whatever fixture name that file already uses for `TransactionListRow` — extend that fixture object with `import_batch_id: null` so existing tests still compile.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/data/mappers.test.ts`
Expected: FAIL — type error / `importBatchId` undefined.

- [ ] **Step 3: Implement mapper changes**

In `src/lib/data/mappers.ts`:
- `TransactionListRow`: add `import_batch_id: string | null;`
- `TransactionListItem`: add `importBatchId: string | null;`
- `rowToTransactionListItem`: add `importBatchId: row.import_batch_id,` to the returned object.
- Add at the bottom:

```ts
export interface RecentImport {
  batchId: string;
  accountName: string;
  rowCount: number;
  firstDate: string;
  lastDate: string;
  importedAt: string;
}
```

- [ ] **Step 4: Implement query changes**

In `src/lib/data/queries.ts`:
- In `getTransactionsData`'s select string, add `import_batch_id` alongside the existing transaction columns.
- Add:

```ts
import type { ExistingTxn } from "@/lib/csv-import/types";
import { rowToAccountSummary, type AccountRow, type AccountSummary, type RecentImport } from "./mappers";

/** Everything the /import wizard needs: candidate target accounts and the
 * user's existing transactions (source values) for dedupe + transfer detection. */
export async function getImportContext(
  supabase: SupabaseClient,
): Promise<{ accounts: AccountSummary[]; existing: ExistingTxn[] }> {
  const [acctRes, txnRes] = await Promise.all([
    supabase.from("financial_accounts").select(
      "id, provider, institution, type, display_name, mask, current_balance, credit_limit, interest_rate, include_in_calculations, archived_at",
    ),
    supabase.from("transactions").select(
      "id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id",
    ),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);
  if (txnRes.error) throw new Error(txnRes.error.message);
  const accounts = (acctRes.data as AccountRow[])
    .map(rowToAccountSummary)
    .filter((a) => a.provider !== "demo" && a.archivedAt === null);
  const existing: ExistingTxn[] = (txnRes.data as Array<{
    id: string; account_id: string; posted_date: string; amount: number;
    direction: string; description: string; is_transfer: boolean; transfer_pair_id: string | null;
  }>).map((t) => ({
    id: t.id, accountId: t.account_id, postedDate: t.posted_date,
    amount: Number(t.amount), direction: t.direction as "inflow" | "outflow",
    description: t.description, isTransfer: t.is_transfer, transferPairId: t.transfer_pair_id,
  }));
  return { accounts, existing };
}

/** Derived batch summaries — no import_batches table; grouped client-side. */
export async function getRecentImports(supabase: SupabaseClient): Promise<RecentImport[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("import_batch_id, posted_date, created_at, financial_accounts!inner(display_name)")
    .not("import_batch_id", "is", null);
  if (error) throw new Error(error.message);
  const groups = new Map<string, RecentImport>();
  for (const r of data as Array<{
    import_batch_id: string; posted_date: string; created_at: string;
    financial_accounts: { display_name: string };
  }>) {
    const g = groups.get(r.import_batch_id);
    if (!g) {
      groups.set(r.import_batch_id, {
        batchId: r.import_batch_id,
        accountName: r.financial_accounts.display_name,
        rowCount: 1,
        firstDate: r.posted_date,
        lastDate: r.posted_date,
        importedAt: r.created_at,
      });
    } else {
      g.rowCount++;
      if (r.posted_date < g.firstDate) g.firstDate = r.posted_date;
      if (r.posted_date > g.lastDate) g.lastDate = r.posted_date;
      if (r.created_at > g.importedAt) g.importedAt = r.created_at;
    }
  }
  return [...groups.values()].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
}
```

(Adjust the `AccountRow` select column list to exactly match the fields `getAccountsData` already selects — copy its select string.)

- [ ] **Step 5: Revalidate `/import` after mutations**

In `src/lib/data/finish-mutation.ts`, add `revalidatePath("/import");` alongside the existing four `revalidatePath` calls (the wizard's server-fetched account list and existing-transaction set must not go stale after account creation or imports).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/lib/data && pnpm typecheck`
Expected: PASS / no type errors. (If `getTransactionsData` callers type the row shape, the new column flows through `TransactionListRow`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/mappers.ts src/lib/data/mappers.test.ts src/lib/data/queries.ts src/lib/data/finish-mutation.ts
git commit -m "feat(import): expose import batches in data layer; import context + recent imports queries"
```

---

### Task 9: Delete guards for imported rows

**Files:**
- Modify: `src/app/actions/transactions.ts` (`deleteTransaction`)
- Modify: `src/app/transactions/TransactionSheet.tsx` (delete UI condition + provenance copy)

**Interfaces:**
- Consumes: `TransactionListItem.importBatchId` from Task 8.
- Produces: server + UI agreement that CSV-imported rows (`importBatchId !== null`) are not individually deletable.

- [ ] **Step 1: Server guard**

In `deleteTransaction` in `src/app/actions/transactions.ts`, change the select and guard:

```ts
const { data: txn, error: fetchErr } = await supabase
  .from("transactions")
  .select("id, import_batch_id, financial_accounts!inner(provider)")
  .eq("id", id)
  .maybeSingle();
if (fetchErr) return { error: fetchErr.message };
if (!txn) return { error: "Transaction not found" };
const provider = (txn.financial_accounts as unknown as { provider: string }).provider;
if (provider !== "manual") {
  return { error: "Imported transactions can't be deleted — recategorize them instead" };
}
if (txn.import_batch_id !== null) {
  return { error: "CSV-imported transactions can't be deleted one by one — undo the whole import from Accounts instead" };
}
```

- [ ] **Step 2: UI guard**

In `src/app/transactions/TransactionSheet.tsx`:
- Line ~195: change the "imported data" notice condition from `txn.accountProvider !== "manual"` to `txn.accountProvider !== "manual" || txn.importBatchId !== null`, and make the copy provenance-aware:

```tsx
{(txn.accountProvider !== "manual" || txn.importBatchId !== null) && (
  <p className="...existing classes...">
    {txn.importBatchId !== null
      ? "CSV-imported data — amount and date are locked; corrections below are tracked. To remove it, undo the whole import from Accounts."
      : `Imported ${txn.accountProvider} data — amount and date are locked; corrections below are tracked.`}
  </p>
)}
```
- Lines ~200 and ~248: change both `txn.accountProvider === "manual"` conditions (the "wrong amount?" hint and the delete button block) to `txn.accountProvider === "manual" && txn.importBatchId === null`.

(Keep the exact existing class names; only conditions and copy change.)

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm vitest run src/lib/data`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/transactions.ts src/app/transactions/TransactionSheet.tsx
git commit -m "feat(import): imported rows are batch-undone, not individually deleted"
```

---

### Task 10: Server actions — `importTransactions` + `undoImport`

**Files:**
- Create: `src/app/actions/imports.ts`

**Interfaces:**
- Consumes: `importTransactionsSchema`, `ImportTransactionsInput`, `ImportResult` (Task 7); `dedupeKey` (Task 5); `dayGap`, `TRANSFER_MAX_DAY_GAP` (Task 6); `insertChunked`, `finishWithRebuild`; `MutationResult`.
- Produces:
  - `importTransactions(input: ImportTransactionsInput): Promise<ImportResult>`
  - `undoImport(batchId: string): Promise<MutationResult>`

- [ ] **Step 1: Implement the action file**

```ts
// src/app/actions/imports.ts
"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dedupeKey } from "@/lib/csv-import/dedupe";
import { dayGap, TRANSFER_MAX_DAY_GAP } from "@/lib/csv-import/transfers";
import { finishWithRebuild } from "@/lib/data/finish-mutation";
import { insertChunked } from "@/lib/data/insert-chunked";
import { importTransactionsSchema, type ImportResult, type ImportTransactionsInput } from "@/lib/validation/imports";
import type { MutationResult } from "@/lib/validation/transactions";

/** Commit an import batch. The client's dedupe/transfer output is advisory:
 * everything is re-validated here against current DB state. All-or-nothing —
 * a failed chunk rolls the whole batch back. */
export async function importTransactions(input: ImportTransactionsInput): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const parsed = importTransactionsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const { data: account, error: acctErr } = await supabase
    .from("financial_accounts")
    .select("id, provider, archived_at")
    .eq("id", v.accountId)
    .maybeSingle();
  if (acctErr) return { error: acctErr.message };
  if (!account) return { error: "Account not found" };
  if (account.provider === "demo") return { error: "Imports go into your own accounts, not demo data" };
  if (account.archived_at) return { error: "This account is archived" };

  // Server-side dedupe re-check against current DB state (stale-client/race guard).
  const { data: existingRows, error: exErr } = await supabase
    .from("transactions")
    .select("id, account_id, posted_date, amount, direction, description, is_transfer, transfer_pair_id");
  if (exErr) return { error: exErr.message };
  const existing = (existingRows ?? []).map((t) => ({
    id: t.id as string,
    accountId: t.account_id as string,
    postedDate: t.posted_date as string,
    amount: Number(t.amount),
    direction: t.direction as "inflow" | "outflow",
    description: t.description as string,
    isTransfer: t.is_transfer as boolean,
    transferPairId: t.transfer_pair_id as string | null,
  }));

  const seen = new Set(
    existing.filter((t) => t.accountId === v.accountId).map((t) => dedupeKey(v.accountId, t)),
  );
  const fresh: typeof v.rows = [];
  let skippedDuplicates = 0;
  for (const r of v.rows) {
    const key = dedupeKey(v.accountId, r);
    if (seen.has(key)) { skippedDuplicates++; continue; }
    seen.add(key);
    fresh.push(r);
  }
  if (fresh.length === 0) return { error: "Nothing new to import — every row already exists" };

  // Re-validate transfer pairs; invalid ones are dropped (the row still
  // imports, unflagged) rather than failing the whole import.
  const byId = new Map(existing.map((t) => [t.id, t]));
  const byLine = new Map(fresh.map((r) => [r.line, r]));
  const usedExisting = new Set<string>();
  const pairByLine = new Map<number, string>();
  for (const p of v.transferPairs) {
    const row = byLine.get(p.line);
    const other = byId.get(p.existingId);
    if (!row || !other || usedExisting.has(other.id)) continue;
    if (other.accountId === v.accountId || other.transferPairId !== null) continue;
    if (other.direction === row.direction || other.amount !== row.amount) continue;
    if (dayGap(other.postedDate, row.postedDate) > TRANSFER_MAX_DAY_GAP) continue;
    usedExisting.add(other.id);
    pairByLine.set(p.line, other.id);
  }

  const batchId = randomUUID();
  const inserts = fresh.map((r) => {
    const pairedWith = pairByLine.get(r.line) ?? null;
    return {
      account_id: v.accountId,
      user_id: user.id,
      posted_date: r.postedDate,
      amount: r.amount,
      direction: r.direction,
      description: r.description,
      category: r.category,
      is_transfer: pairedWith !== null,
      transfer_pair_id: pairedWith,
      import_batch_id: batchId,
    };
  });

  try {
    await insertChunked(supabase, "transactions", inserts);
  } catch (e) {
    // All-or-nothing: remove whatever landed before the failing chunk.
    await supabase.from("transactions").delete().eq("import_batch_id", batchId);
    return { error: e instanceof Error ? e.message : "Import failed — nothing was saved" };
  }

  const finish = await finishWithRebuild(supabase);
  return { ...finish, batchId, imported: inserts.length, skippedDuplicates };
}

/** Remove exactly one import batch's rows, then rebuild. */
export async function undoImport(batchId: string): Promise<MutationResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (!z.uuid().safeParse(batchId).success) return { error: "Invalid import" };

  const { data: deleted, error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("import_batch_id", batchId)
    .select("id");
  if (delErr) return { error: delErr.message };
  if (!deleted || deleted.length === 0) return { error: "Import not found" };

  return finishWithRebuild(supabase);
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (Action correctness is exercised by the RLS additions in Task 16 and live QA in Task 18 — the logic-bearing pieces, `dedupeKey`/`dayGap`/schemas, are already unit-tested. This matches the repo's existing convention of untested glue actions.)

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/imports.ts
git commit -m "feat(import): importTransactions + undoImport server actions"
```

---

### Task 11: `/import` route — page, wizard shell, upload step

**Files:**
- Create: `src/app/import/page.tsx`
- Create: `src/app/import/ImportWizard.tsx`
- Create: `src/app/import/UploadStep.tsx`
- Create: `src/app/import/loading.tsx` (copy the pattern from `src/app/accounts/loading.tsx`)
- Create: `src/app/import/error.tsx` (copy the pattern from `src/app/accounts/error.tsx`, copy adjusted to "import")

**Interfaces:**
- Consumes: `getImportContext`, `getProfile` (queries); `parseCsv`, `proposeMapping`, types; `AccountSheet` from `@/app/accounts/AccountSheet`; `AccountSummary`.
- Produces: `ImportWizard` client component owning the step state machine `"upload" | "map" | "preview" | "summary"`; `UploadStep` with `onReady(parsed: ParsedCsv, fileName: string)` + target-account selection.

- [ ] **Step 1: Server page**

```tsx
// src/app/import/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getImportContext, getProfile } from "@/lib/data/queries";
import { ImportWizard } from "./ImportWizard";

export default async function ImportPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile?.onboarding_completed_at) redirect("/onboarding");
  const { accounts, existing } = await getImportContext(supabase);
  return <ImportWizard accounts={accounts} existing={existing} />;
}
```

- [ ] **Step 2: Wizard shell**

```tsx
// src/app/import/ImportWizard.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ColumnMapping, ExistingTxn, ParsedCsv } from "@/lib/csv-import/types";
import { normalizeRows } from "@/lib/csv-import/normalize";
import { markDuplicates } from "@/lib/csv-import/dedupe";
import { detectTransfers } from "@/lib/csv-import/transfers";
import { importTransactions } from "@/app/actions/imports";
import type { ImportResult } from "@/lib/validation/imports";
import { UploadStep } from "./UploadStep";
import { MapStep } from "./MapStep";
import { PreviewStep } from "./PreviewStep";
import { SummaryStep } from "./SummaryStep";

type Step = "upload" | "map" | "preview" | "summary";
const STEP_LABELS: Record<Step, string> = {
  upload: "Choose file", map: "Map columns", preview: "Preview", summary: "Done",
};

export function ImportWizard({ accounts, existing }: { accounts: AccountSummary[]; existing: ExistingTxn[] }) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [removedPairs, setRemovedPairs] = useState<ReadonlySet<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  // Deterministic pipeline: normalize -> dedupe -> transfers. Pure functions
  // from csv-import; no financial logic lives in this component.
  const preview = useMemo(() => {
    if (!parsed || !mapping || !accountId) return null;
    const normalized = normalizeRows(parsed, mapping);
    const { fresh, duplicates } = markDuplicates(normalized.rows, accountId, existing);
    const pairs = detectTransfers(fresh, accountId, existing);
    return { normalized, fresh, duplicates, pairs };
  }, [parsed, mapping, accountId, existing]);

  async function commit() {
    if (!preview || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const keptPairs = preview.pairs.filter((p) => !removedPairs.has(p.line));
    const res = await importTransactions({
      accountId,
      rows: preview.fresh.map(({ line, postedDate, amount, direction, description, category }) => ({
        line, postedDate, amount, direction, description, category,
      })),
      transferPairs: keptPairs,
    });
    setSubmitting(false);
    if (res.error) setSubmitError(res.error);
    else { setResult(res); setStep("summary"); }
  }

  const steps: Step[] = ["upload", "map", "preview", "summary"];
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/accounts" aria-label="Back to accounts" className="rounded-lg p-1 text-secondary hover:text-primary">
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="text-lg font-semibold text-primary">Import CSV</h1>
      </div>
      <ol className="mb-6 flex gap-2 text-xs text-secondary" aria-label="Import steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={s === step ? "step" : undefined}
              className={s === step ? "font-semibold text-primary" : ""}>
            {i + 1}. {STEP_LABELS[s]}
          </li>
        ))}
      </ol>

      {step === "upload" && (
        <UploadStep
          accounts={accounts}
          accountId={accountId}
          onAccountChange={setAccountId}
          onReady={(p, name) => { setParsed(p); setFileName(name); setMapping(null); setRemovedPairs(new Set()); setStep("map"); }}
        />
      )}
      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          fileName={fileName}
          initialMapping={mapping}
          onBack={() => setStep("upload")}
          onConfirm={(m) => { setMapping(m); setStep("preview"); }}
        />
      )}
      {step === "preview" && preview && (
        <PreviewStep
          preview={preview}
          accounts={accounts}
          existing={existing}
          removedPairs={removedPairs}
          onTogglePair={(line) => {
            const next = new Set(removedPairs);
            if (next.has(line)) next.delete(line); else next.add(line);
            setRemovedPairs(next);
          }}
          submitting={submitting}
          submitError={submitError}
          onBack={() => setStep("map")}
          onCommit={commit}
        />
      )}
      {step === "summary" && result && (
        <SummaryStep result={result} accountId={accountId} fresh={preview?.fresh ?? []} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Upload step**

```tsx
// src/app/import/UploadStep.tsx
"use client";

import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ParsedCsv } from "@/lib/csv-import/types";
import { parseCsv } from "@/lib/csv-import/parse";
import { AccountSheet } from "@/app/accounts/AccountSheet";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

export function UploadStep({
  accounts, accountId, onAccountChange, onReady,
}: {
  accounts: AccountSummary[];
  accountId: string;
  onAccountChange: (id: string) => void;
  onReady: (parsed: ParsedCsv, fileName: string) => void;
}) {
  const [error, setError] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    if (!/\.csv$/i.test(file.name)) { setError("Choose a .csv file — bank sites usually offer one under Export or Download."); return; }
    if (file.size > MAX_BYTES) { setError("That file is over 5 MB. Export a shorter date range and try again."); return; }
    const parsed = parseCsv(await file.text());
    if (parsed.headers.length === 0) { setError("That file looks empty — no header row or data found."); return; }
    if (parsed.rows.length === 0) { setError("The file has a header but no data rows."); return; }
    if (parsed.rows.length > MAX_ROWS) { setError(`That file has ${parsed.rows.length.toLocaleString()} rows (max 10,000). Export a shorter date range.`); return; }
    onReady(parsed, file.name);
  }

  return (
    <section className="space-y-4">
      <div>
        <label htmlFor="import-account" className="mb-1 block text-sm font-medium text-primary">
          Import into which account?
        </label>
        <p className="mb-2 text-xs text-secondary">
          One CSV holds one account&apos;s transactions — pick where these belong.
        </p>
        <select
          id="import-account"
          value={accountId}
          onChange={(e) => onAccountChange(e.target.value)}
          className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm text-primary"
        >
          <option value="">Choose an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAddingAccount(true)}
          className="mt-2 inline-flex items-center gap-1 text-sm text-accent"
        >
          <Plus size={16} aria-hidden /> New account
        </button>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="import-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        />
        <button
          type="button"
          disabled={!accountId}
          onClick={() => inputRef.current?.click()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-on-accent disabled:opacity-50"
        >
          <Upload size={18} aria-hidden /> Choose CSV file
        </button>
        {!accountId && <p className="mt-1 text-xs text-secondary">Pick an account first.</p>}
        {error && <p role="alert" className="mt-2 text-sm text-negative">✗ {error}</p>}
        <p className="mt-3 text-xs text-secondary">
          Your file is read on this device. Only the transactions you approve in the preview are saved.
        </p>
      </div>

      <AccountSheet account={null} open={addingAccount} onClose={() => setAddingAccount(false)} />
    </section>
  );
}
```

**Note on styling:** the exact utility classes above (`bg-surface`, `text-negative`, `text-accent`, `border-subtle`, `text-on-accent`) must be replaced with whatever tokens `AccountsView.tsx`/`AccountSheet.tsx` actually use — open those files and copy their button/input/error class strings verbatim so the screen matches the app. Same rule for every component in Tasks 12–15.

- [ ] **Step 4: loading.tsx and error.tsx**

Copy `src/app/accounts/loading.tsx` and `src/app/accounts/error.tsx` into `src/app/import/`, changing user-facing copy from "accounts" to "import" (e.g. "Something went wrong loading the import screen.").

- [ ] **Step 5: Verify it renders**

Run: `pnpm typecheck` then `pnpm dev`, visit `http://localhost:3000/import` (logged in via existing dev flow).
Expected: step indicator, account picker listing non-demo accounts, disabled file button until an account is chosen. (MapStep/PreviewStep/SummaryStep don't exist yet — stub them as `export function MapStep() { return null; }` etc. in this task if needed to compile, or defer this manual check to Task 14.)

- [ ] **Step 6: Commit**

```bash
git add src/app/import/
git commit -m "feat(import): /import route, wizard shell, upload step"
```

---

### Task 12: Map-columns step

**Files:**
- Create: `src/app/import/MapStep.tsx`

**Interfaces:**
- Consumes: `ParsedCsv`, `ColumnMapping`, `MappingProposal` types; `proposeMapping` (Task 3); `parseDateToken` (Task 4); `CATEGORIES`, `CATEGORY_LABELS`.
- Produces: `MapStep({ parsed, fileName, initialMapping, onBack, onConfirm })` — `onConfirm(mapping: ColumnMapping)` fires only when date + description + (amount or debit+credit) are chosen.

- [ ] **Step 1: Implement MapStep**

```tsx
// src/app/import/MapStep.tsx
"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/config/categories";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/config/categories";
import type { ColumnMapping, ParsedCsv } from "@/lib/csv-import/types";
import { proposeMapping } from "@/lib/csv-import/detect";
import { parseDateToken } from "@/lib/csv-import/normalize";

const MAX_CATEGORY_VALUES = 50;

function ColumnSelect({
  id, label, value, detected, headers, onChange, optional = false,
}: {
  id: string; label: string; value: number; detected: boolean;
  headers: string[]; onChange: (idx: number) => void; optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-primary">
        {label}
        {detected && <span className="ml-2 text-xs font-normal text-secondary">detected from your file&apos;s headers</span>}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm text-primary"
      >
        <option value={-1}>{optional ? "Not in this file" : "Choose a column…"}</option>
        {headers.map((h, i) => (
          <option key={`${i}-${h}`} value={i}>{h || `Column ${i + 1}`}</option>
        ))}
      </select>
    </div>
  );
}

export function MapStep({
  parsed, fileName, initialMapping, onBack, onConfirm,
}: {
  parsed: ParsedCsv;
  fileName: string;
  initialMapping: ColumnMapping | null;
  onBack: () => void;
  onConfirm: (mapping: ColumnMapping) => void;
}) {
  const proposal = useMemo(() => proposeMapping(parsed), [parsed]);
  const [m, setM] = useState<ColumnMapping>(initialMapping ?? proposal.mapping);
  const set = (patch: Partial<ColumnMapping>) => setM((cur) => ({ ...cur, ...patch }));

  const sampleDate = m.date !== -1 ? (parsed.rows[0]?.cells[m.date] ?? "") : "";
  const amountChosen = m.amount !== -1 || (m.debit !== -1 && m.credit !== -1);
  const ready = m.date !== -1 && m.description !== -1 && amountChosen;

  const distinctCategoryValues = useMemo(() => {
    if (m.category === -1) return [];
    const values = new Set<string>();
    for (const { cells } of parsed.rows) {
      const raw = (cells[m.category] ?? "").trim();
      if (raw !== "") values.add(raw.toLowerCase());
      if (values.size > MAX_CATEGORY_VALUES) break;
    }
    return [...values].sort();
  }, [parsed, m.category]);

  return (
    <section className="space-y-4">
      <p className="text-sm text-secondary">Tell us what each column in <span className="font-medium text-primary">{fileName}</span> means.</p>

      <ColumnSelect id="map-date" label="Date" value={m.date} detected={proposal.detected.date}
        headers={parsed.headers} onChange={(date) => set({ date })} />

      {m.date !== -1 && sampleDate !== "" && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-primary">How should dates be read?</legend>
          <p className="mb-2 text-xs text-secondary">Your file&apos;s first date is “{sampleDate}”.</p>
          {(["mdy", "dmy", "ymd"] as const).map((f) => {
            const iso = parseDateToken(sampleDate, f);
            return (
              <label key={f} className="mb-1 flex items-center gap-2 text-sm text-primary">
                <input type="radio" name="date-format" checked={m.dateFormat === f} onChange={() => set({ dateFormat: f })} />
                {f === "mdy" ? "Month/Day/Year" : f === "dmy" ? "Day/Month/Year" : "Year-Month-Day"}
                <span className="text-xs text-secondary">→ {iso ?? "doesn't fit this file"}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      <ColumnSelect id="map-desc" label="Description" value={m.description} detected={proposal.detected.description}
        headers={parsed.headers} onChange={(description) => set({ description })} />

      <ColumnSelect id="map-amount" label="Amount (single signed column)" value={m.amount}
        detected={proposal.detected.amount && m.amount !== -1} headers={parsed.headers}
        onChange={(amount) => set({ amount, ...(amount !== -1 ? { debit: -1, credit: -1 } : {}) })} optional />

      {m.amount === -1 && (
        <div className="grid grid-cols-2 gap-3">
          <ColumnSelect id="map-debit" label="Debit (money out)" value={m.debit} detected={m.debit !== -1}
            headers={parsed.headers} onChange={(debit) => set({ debit })} />
          <ColumnSelect id="map-credit" label="Credit (money in)" value={m.credit} detected={m.credit !== -1}
            headers={parsed.headers} onChange={(credit) => set({ credit })} />
        </div>
      )}

      {m.amount !== -1 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-primary">Which sign means money in?</legend>
          <label className="mb-1 flex items-center gap-2 text-sm text-primary">
            <input type="radio" name="sign" checked={m.signConvention === "positive_inflow"} onChange={() => set({ signConvention: "positive_inflow" })} />
            Positive = money in <span className="text-xs text-secondary">(most bank accounts)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-primary">
            <input type="radio" name="sign" checked={m.signConvention === "positive_outflow"} onChange={() => set({ signConvention: "positive_outflow" })} />
            Positive = money out <span className="text-xs text-secondary">(many credit-card exports)</span>
          </label>
        </fieldset>
      )}

      <ColumnSelect id="map-category" label="Category" value={m.category} detected={proposal.detected.category}
        headers={parsed.headers} onChange={(category) => set({ category })} optional />

      {m.category !== -1 && distinctCategoryValues.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-primary">Match your bank&apos;s categories</p>
          <p className="mb-2 text-xs text-secondary">
            Unmatched values fall back to “Income” for money in and “Other” for money out.
            {distinctCategoryValues.length > MAX_CATEGORY_VALUES && ` Showing the first ${MAX_CATEGORY_VALUES} values.`}
          </p>
          <ul className="space-y-1">
            {distinctCategoryValues.slice(0, MAX_CATEGORY_VALUES).map((val) => (
              <li key={val} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-primary">{val}</span>
                <select
                  aria-label={`PFI category for ${val}`}
                  value={m.categoryValues[val] ?? ""}
                  onChange={(e) => {
                    const next = { ...m.categoryValues };
                    if (e.target.value === "") delete next[val];
                    else next[val] = e.target.value as Category;
                    set({ categoryValues: next });
                  }}
                  className="rounded-lg border border-subtle bg-surface px-2 py-1 text-sm text-primary"
                >
                  <option value="">Use default</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-subtle px-4 py-2 text-sm text-primary">Back</button>
        <button type="button" disabled={!ready} onClick={() => onConfirm(m)}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50">
          Preview import
        </button>
      </div>
      {!ready && <p className="text-xs text-secondary">Choose a date, description, and amount column (or a debit/credit pair) to continue.</p>}
    </section>
  );
}
```

(Styling-token rule from Task 11 applies — copy real class strings from existing components.)

- [ ] **Step 2: Verify**

Run: `pnpm typecheck`; then in `pnpm dev`, upload a small CSV and confirm: proposals pre-filled, date-format radio shows the sample rendered both ways, debit/credit selectors appear only when no single amount column, category table appears when a category column is chosen.

- [ ] **Step 3: Commit**

```bash
git add src/app/import/MapStep.tsx
git commit -m "feat(import): column-mapping step with detection hints and live date examples"
```

---

### Task 13: Preview step

**Files:**
- Create: `src/app/import/PreviewStep.tsx`

**Interfaces:**
- Consumes: wizard `preview` object `{ normalized: NormalizeResult; fresh: NormalizedRow[]; duplicates: NormalizedRow[]; pairs: TransferPair[] }`; `accounts`, `existing`, `removedPairs`, callbacks from Task 11.
- Produces: `PreviewStep(props)` as wired in Task 11's wizard.

- [ ] **Step 1: Implement PreviewStep**

```tsx
// src/app/import/PreviewStep.tsx
"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, CopyX } from "lucide-react";
import type { AccountSummary } from "@/lib/data/mappers";
import type { ExistingTxn, NormalizeResult, NormalizedRow, TransferPair } from "@/lib/csv-import/types";

interface Preview {
  normalized: NormalizeResult;
  fresh: NormalizedRow[];
  duplicates: NormalizedRow[];
  pairs: TransferPair[];
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function RowLine({ r }: { r: NormalizedRow }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="truncate text-primary">{r.postedDate} · {r.description}</span>
      <span className="shrink-0 tabular-nums text-primary">
        {r.direction === "inflow" ? "+" : "−"}{money(r.amount)}
      </span>
    </li>
  );
}

function Chip({
  icon, label, count, open, onToggle,
}: {
  icon: React.ReactNode; label: string; count: number; open: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="inline-flex items-center gap-1 rounded-full border border-subtle px-3 py-1 text-sm text-primary">
      {icon} {count} {label}
    </button>
  );
}

export function PreviewStep({
  preview, accounts, existing, removedPairs, onTogglePair, submitting, submitError, onBack, onCommit,
}: {
  preview: Preview;
  accounts: AccountSummary[];
  existing: ExistingTxn[];
  removedPairs: ReadonlySet<number>;
  onTogglePair: (line: number) => void;
  submitting: boolean;
  submitError: string;
  onBack: () => void;
  onCommit: () => void;
}) {
  const [openSection, setOpenSection] = useState<"" | "new" | "dup" | "transfer" | "error">("");
  const toggle = (s: typeof openSection) => setOpenSection((cur) => (cur === s ? "" : s));
  const { fresh, duplicates, pairs } = preview;
  const errors = preview.normalized.errors;
  const rowByLine = new Map(fresh.map((r) => [r.line, r]));
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.displayName ?? "another account";
  const keptPairCount = pairs.filter((p) => !removedPairs.has(p.line)).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip icon={<CheckCircle2 size={14} aria-hidden />} label="new" count={fresh.length} open={openSection === "new"} onToggle={() => toggle("new")} />
        <Chip icon={<CopyX size={14} aria-hidden />} label="duplicates skipped" count={duplicates.length} open={openSection === "dup"} onToggle={() => toggle("dup")} />
        <Chip icon={<ArrowLeftRight size={14} aria-hidden />} label="transfer pairs" count={pairs.length} open={openSection === "transfer"} onToggle={() => toggle("transfer")} />
        <Chip icon={<AlertTriangle size={14} aria-hidden />} label="rows with errors" count={errors.length} open={openSection === "error"} onToggle={() => toggle("error")} />
      </div>

      {openSection === "new" && (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-subtle p-3">
          {fresh.map((r) => <RowLine key={r.line} r={r} />)}
          {fresh.length === 0 && <li className="text-sm text-secondary">No new rows.</li>}
        </ul>
      )}

      {openSection === "dup" && (
        <div className="rounded-lg border border-subtle p-3">
          <p className="mb-2 text-xs text-secondary">
            Why skipped? An identical transaction (same date, amount, direction, and description) already
            exists in this account — usually from an earlier export of an overlapping date range.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {duplicates.map((r) => <RowLine key={r.line} r={r} />)}
          </ul>
        </div>
      )}

      {openSection === "transfer" && (
        <div className="rounded-lg border border-subtle p-3">
          <p className="mb-2 text-xs text-secondary">
            Why a transfer? An opposite transaction with the same amount exists within 3 days on another
            of your accounts. Transfers don&apos;t count as income or spending. Un-check any that are wrong.
          </p>
          <ul className="space-y-2">
            {pairs.map((p) => {
              const row = rowByLine.get(p.line);
              const other = existingById.get(p.existingId);
              if (!row || !other) return null;
              return (
                <li key={p.line} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`pair-${p.line}`}
                    checked={!removedPairs.has(p.line)}
                    onChange={() => onTogglePair(p.line)}
                  />
                  <label htmlFor={`pair-${p.line}`} className="text-primary">
                    {row.postedDate} · {row.description} · {money(row.amount)}
                    <span className="block text-xs text-secondary">
                      matches {other.postedDate} “{other.description}” on {accountName(other.accountId)}
                    </span>
                  </label>
                </li>
              );
            })}
            {pairs.length === 0 && <li className="text-sm text-secondary">No transfers detected.</li>}
          </ul>
        </div>
      )}

      {openSection === "error" && (
        <div className="rounded-lg border border-subtle p-3">
          <p className="mb-2 text-xs text-secondary">
            These rows couldn&apos;t be read and will not be imported. Fix them in the file and re-import,
            or continue without them.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {errors.map((e) => (
              <li key={e.line} className="text-sm text-primary">Line {e.line}: {e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {submitError && <p role="alert" className="text-sm text-negative">✗ {submitError} — your preview is unchanged; you can retry.</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onBack} disabled={submitting} className="rounded-lg border border-subtle px-4 py-2 text-sm text-primary">Back</button>
        <button
          type="button"
          onClick={onCommit}
          disabled={submitting || fresh.length === 0}
          className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
        >
          {submitting ? "Importing…" : fresh.length === 0 ? "Nothing new to import" : `Import ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}${keptPairCount > 0 ? ` (${keptPairCount} as transfers)` : ""}`}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify**

`pnpm typecheck`; in `pnpm dev`, walk a file to preview: chips expand, duplicate/transfer explainers show, un-checking a pair updates the commit button count, all-duplicates file disables commit with "Nothing new to import".

- [ ] **Step 3: Commit**

```bash
git add src/app/import/PreviewStep.tsx
git commit -m "feat(import): preview step with dedupe, transfer, and error review"
```

---

### Task 14: Summary step + undo

**Files:**
- Create: `src/app/import/SummaryStep.tsx`
- Modify: `src/app/import/ImportWizard.tsx` (only if the props wired in Task 11 need adjusting after implementation)

**Interfaces:**
- Consumes: `ImportResult` (Task 7), `undoImport` (Task 10), `NormalizedRow`.
- Produces: `SummaryStep({ result, accountId, fresh })`.

- [ ] **Step 1: Implement SummaryStep**

```tsx
// src/app/import/SummaryStep.tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import type { NormalizedRow } from "@/lib/csv-import/types";
import { CATEGORY_LABELS, type Category } from "@/lib/config/categories";
import { undoImport } from "@/app/actions/imports";
import type { ImportResult } from "@/lib/validation/imports";

export function SummaryStep({
  result, accountId, fresh,
}: {
  result: ImportResult;
  accountId: string;
  fresh: NormalizedRow[];
}) {
  const router = useRouter();
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState("");

  const byCategory = useMemo(() => {
    const counts = new Map<Category, number>();
    for (const r of fresh) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [fresh]);
  const dates = fresh.map((r) => r.postedDate).sort();
  const from = dates[0] ?? "";
  const to = dates[dates.length - 1] ?? "";

  async function handleUndo() {
    if (!result.batchId || undoing) return;
    setUndoing(true);
    setUndoError("");
    const res = await undoImport(result.batchId);
    setUndoing(false);
    if (res.error) setUndoError(res.error);
    else { setUndone(true); router.refresh(); }
  }

  if (undone) {
    return (
      <section className="space-y-3 text-center">
        <p className="text-sm text-primary">Import undone — those transactions were removed and your index was recalculated.</p>
        <Link href="/accounts" className="text-sm text-accent">Back to accounts</Link>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-primary">
        <CheckCircle2 size={18} aria-hidden />
        Imported {result.imported} transaction{result.imported === 1 ? "" : "s"}
        {result.skippedDuplicates ? ` · ${result.skippedDuplicates} duplicates skipped` : ""}
      </p>
      {result.warning && <p role="alert" className="text-sm text-primary">{result.warning}</p>}

      {byCategory.length > 0 && (
        <ul className="rounded-lg border border-subtle p-3 text-sm text-primary">
          {byCategory.map(([cat, n]) => (
            <li key={cat} className="flex justify-between"><span>{CATEGORY_LABELS[cat]}</span><span className="tabular-nums">{n}</span></li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Link
          href={`/transactions?account=${accountId}${from ? `&from=${from}&to=${to}` : ""}`}
          className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-on-accent"
        >
          See them in Transactions
        </Link>
        <Link href="/score" className="rounded-lg border border-subtle px-4 py-2 text-center text-sm text-primary">
          How this changed your score
        </Link>
        {confirmingUndo ? (
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="text-primary">Remove all {result.imported} imported transactions?</span>
            <button type="button" onClick={handleUndo} disabled={undoing} className="font-medium text-negative">
              {undoing ? "Undoing…" : "Yes, undo"}
            </button>
            <button type="button" onClick={() => setConfirmingUndo(false)} disabled={undoing} className="text-secondary">Keep</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingUndo(true)} className="text-sm text-secondary underline">
            Undo this import
          </button>
        )}
        {undoError && <p role="alert" className="text-sm text-negative">✗ {undoError}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Full-flow manual check**

`pnpm dev`: import a small fixture CSV end-to-end. Confirm summary counts match, "See them in Transactions" lands filtered, undo removes rows (check `/transactions`) and dashboard reflects the rebuild.

- [ ] **Step 3: Commit**

```bash
git add src/app/import/SummaryStep.tsx src/app/import/ImportWizard.tsx
git commit -m "feat(import): summary step with per-category counts and batch undo"
```

---

### Task 15: Entry points — accounts screen + empty dashboard

**Files:**
- Modify: `src/app/accounts/page.tsx` (fetch recent imports)
- Modify: `src/app/accounts/AccountsView.tsx` ("Import CSV" action + Recent imports section)
- Create: `src/app/accounts/RecentImports.tsx`
- Modify: `src/components/dashboard/EmptyDashboard.tsx` (CSV CTA)

**Interfaces:**
- Consumes: `getRecentImports`, `RecentImport` (Task 8); `undoImport` (Task 10).
- Produces: `RecentImports({ imports }: { imports: RecentImport[] })` client component.

- [ ] **Step 1: Page fetch**

In `src/app/accounts/page.tsx`:

```tsx
import { getAccountsData, getProfile, getRecentImports } from "@/lib/data/queries";
// …
const [accounts, recentImports] = await Promise.all([
  getAccountsData(supabase),
  getRecentImports(supabase),
]);
return <AccountsView accounts={accounts} recentImports={recentImports} />;
```

- [ ] **Step 2: RecentImports component**

```tsx
// src/app/accounts/RecentImports.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RecentImport } from "@/lib/data/mappers";
import { undoImport } from "@/app/actions/imports";

export function RecentImports({ imports }: { imports: RecentImport[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (imports.length === 0) return null;

  async function handleUndo(batchId: string) {
    setBusy(batchId);
    setError("");
    const res = await undoImport(batchId);
    setBusy(null);
    setConfirming(null);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <section aria-labelledby="recent-imports-heading" className="mt-6">
      <h2 id="recent-imports-heading" className="mb-2 text-sm font-semibold text-primary">Recent imports</h2>
      <p className="mb-2 text-xs text-secondary">
        Imported transactions are corrected, not deleted — but a whole import can be undone here.
      </p>
      {error && <p role="alert" className="mb-2 text-sm text-negative">✗ {error}</p>}
      <ul className="space-y-2">
        {imports.map((imp) => (
          <li key={imp.batchId} className="flex items-center justify-between gap-2 rounded-lg border border-subtle p-3 text-sm">
            <div>
              <p className="text-primary">{imp.accountName} · {imp.rowCount} transaction{imp.rowCount === 1 ? "" : "s"}</p>
              <p className="text-xs text-secondary">{imp.firstDate} → {imp.lastDate} · imported {imp.importedAt.slice(0, 10)}</p>
            </div>
            {confirming === imp.batchId ? (
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" disabled={busy === imp.batchId} onClick={() => handleUndo(imp.batchId)} className="font-medium text-negative">
                  {busy === imp.batchId ? "Undoing…" : "Confirm undo"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="text-secondary">Keep</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(imp.batchId)} className="shrink-0 text-secondary underline">
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Wire into AccountsView**

In `src/app/accounts/AccountsView.tsx`:
- Change props to `{ accounts, recentImports }: { accounts: AccountSummary[]; recentImports: RecentImport[] }`.
- Next to the existing "Add account" button (line ~66), add a sibling link with the same styling idiom:

```tsx
<Link href="/import" className="...same classes as the Add account button, secondary variant...">
  <Upload size={18} aria-hidden /> Import CSV
</Link>
```
(`Upload` from `lucide-react`; copy the exact class string from the "Add account" button, using the secondary/outline variant if one exists in the file.)
- Render `<RecentImports imports={recentImports} />` after the account groups.

- [ ] **Step 4: EmptyDashboard CTA**

In `src/components/dashboard/EmptyDashboard.tsx`, alongside the existing demo-data CTA, add:

```tsx
<Link href="/import" className="...match the existing secondary CTA styling in this file...">
  Import a CSV from your bank
</Link>
```

- [ ] **Step 5: Verify + commit**

`pnpm typecheck && pnpm lint`; manual check: `/accounts` shows Import CSV + recent imports after an import; empty-state dashboard (fresh user) shows the CSV CTA.

```bash
git add src/app/accounts/ src/components/dashboard/EmptyDashboard.tsx
git commit -m "feat(import): accounts + empty-dashboard entry points, recent imports with undo"
```

---

### Task 16: RLS isolation extension

**Files:**
- Modify: `scripts/test-rls.mts`

**Interfaces:**
- Consumes: existing `check`/`makeUser` helpers and user A's account created earlier in the script.

- [ ] **Step 1: Add three checks** (after the existing transaction checks, before cleanup; follow the file's existing style)

```ts
// CSV import batch isolation.
const importBatchId = randomUUID();
const { error: impErr } = await a.client.from("transactions").insert({
  account_id: acct!.id, user_id: a.id, posted_date: "2026-07-01", amount: 12.34,
  direction: "outflow", description: "rls import row", category: "other",
  import_batch_id: importBatchId,
});
check("A can insert an imported row with a batch id", !impErr, impErr?.message);

const { data: bBatchRead } = await b.client.from("transactions")
  .select("id").eq("import_batch_id", importBatchId);
check("B cannot read A's imported batch rows", (bBatchRead ?? []).length === 0);

const { data: bBatchDel } = await b.client.from("transactions")
  .delete().eq("import_batch_id", importBatchId).select("id");
check("B cannot delete A's imported batch rows (undo isolation)", (bBatchDel ?? []).length === 0);

const { error: aBatchMutErr } = await a.client.from("transactions")
  .update({ import_batch_id: randomUUID() }).eq("import_batch_id", importBatchId).select("id").single();
check("import_batch_id is immutable after insert", !!aBatchMutErr);
```

- [ ] **Step 2: Run against the live project**

Run: `pnpm test:rls`
Expected: **19/19** checks pass (15 existing + 4 new), no leaked users.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-rls.mts
git commit -m "feat(import): RLS checks for import-batch isolation and immutability"
```

---

### Task 17: Docs + full verification

**Files:**
- Modify: `docs/CURRENT_PHASE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/DATA_MODEL.md` (if it lists transaction columns)

- [ ] **Step 1: DECISIONS.md** — append entry (next number after the latest):

> **CSV import architecture (2026-07-17).** Client-side parse (raw file never leaves the browser) + server-action trust boundary; framework-free `src/lib/csv-import/`; provenance via `transactions.import_batch_id` only (no staging table, no `import_batches` table — batch summaries are derived); imported rows are corrected via `user_override` and removed only by whole-batch undo; transfer pairs recorded on the new row only (source-column immutability). Alternatives considered: server-side parse + staging table (more moving parts, no v1 benefit), one-shot import without preview (guts the review loop). See `docs/superpowers/specs/2026-07-17-csv-import-design.md`.

- [ ] **Step 2: KNOWN_LIMITATIONS.md** — add a "CSV import v1" section:

- Exact-match dedupe only; banks that shift posting dates between exports produce duplicates the import won't catch (fuzzy matching deferred).
- Transfer pairing is one-sided when the counterpart already exists: the existing row keeps `transfer_pair_id = null` (and its confidence penalty) because source columns are immutable.
- No keyword/merchant categorization heuristics yet; unmapped rows default to income/other by direction.
- 5 MB / 10 000-row cap; no saved per-account mappings (re-map on every import).
- Sign-convention and date-format choices apply file-wide (no per-row override).

- [ ] **Step 3: ROADMAP.md** — Phase 3 section: mark CSV import scope landed (date), leaving recurring detection as the remaining item.

- [ ] **Step 4: CURRENT_PHASE.md** — new "Completed" block for this slice (module, migration, actions, screens, entry points, test counts), update "Next three priorities" (CSV import drops off), update test-status counts.

- [ ] **Step 5: Full verification**

Run: `pnpm check`
Expected: lint 0 errors (2 pre-existing warnings allowed), typecheck clean, **all tests green** (169 existing + ~36 new across parse/detect/normalize/dedupe/transfers/imports-validation/mappers ≈ 205), build succeeds with `/import` route compiled.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: CSV import slice — decisions, limitations, phase status"
```

---

### Task 18: Live browser QA

**Files:**
- Create (scratch only, not committed): fixture CSVs in the session scratchpad.

- [ ] **Step 1: Create fixtures** in the scratchpad directory:

`fixture-checking.csv` (signed amounts, transfer counterpart against an existing manual savings account entry you create first):

```csv
Posting Date,Description,Amount
07/01/2026,EMPLOYER PAYROLL,2500.00
07/02/2026,COFFEE SHOP,-4.50
07/03/2026,TRANSFER TO SAVINGS,-500.00
07/05/2026,GROCERY MART,-82.13
```

`fixture-debit-credit.csv` (debit/credit pair + category column):

```csv
Date,Payee,Debit,Credit,Category
01/07/2026,SHOP A,12.00,,Shopping
02/07/2026,REFUND,,12.00,Shopping
03/07/2026,BAD ROW,,,
```

`fixture-errors.csv` (bad rows):

```csv
Date,Description,Amount
notadate,X,5.00
07/01/2026,,5.00
07/02/2026,OK ROW,7.25
```

- [ ] **Step 2: QA script** (gstack `browse` or Playwright-driven browser, 390×844 **and** 1280×900, real Supabase dev login):

1. Fresh/manual account setup: create a manual savings account, hand-add a `+$500.00` "Transfer from checking" transaction dated 2026-07-04.
2. `/accounts` → Import CSV → full happy path with `fixture-checking.csv` into a new inline-created checking account: detection pre-fills, preview shows 4 new / 0 duplicates / **1 transfer pair** (the −500 vs the manual +500, 1-day gap), commit, summary counts match, `/transactions` link lands filtered, chart/score updated.
3. Re-import the same file → preview shows 0 new / 4 duplicates, commit disabled with "Nothing new to import".
4. `fixture-debit-credit.csv` with `dmy` date format chosen: debit/credit directions correct, category value-mapping table maps "shopping" → Shopping, the both-empty row lands in errors.
5. `fixture-errors.csv`: two error rows listed with reasons, one row imports.
6. Transfer un-flag: re-run a file with a detected pair, un-check it, verify the row imports unflagged (check `/transactions` detail).
7. Undo: from summary and from `/accounts` Recent imports (two-step confirm); rows gone, index rebuilt, empty "Recent imports" hides the section.
8. Imported-row posture: detail sheet shows locked copy, no delete button; recategorize works and shows "corrected".
9. Console clean on `/import`, `/accounts`, `/transactions` at both viewports.
10. Write the QA report to `.superpowers/sdd/csv-import-qa-report.md` (gitignored, local-only).

- [ ] **Step 3: Fix anything found** (each fix: failing check → fix → re-verify → commit).

- [ ] **Step 4: Final `pnpm check` + update CURRENT_PHASE.md** with QA results (per house convention), commit.

```bash
git add docs/CURRENT_PHASE.md
git commit -m "docs: CSV import live QA results"
```
