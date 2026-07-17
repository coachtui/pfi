# CSV Import — Design

_Date: 2026-07-17. Status: approved in brainstorming; implementation plan to follow._

Completes the Phase 3 remainder (ROADMAP): column mapping, preview, dedupe, transfer
detection, import summary. Phase 3 exit criterion: a user can replace demo data with
their own.

## Scope decisions (confirmed with user)

| Question | Decision |
| --- | --- |
| Target CSV sources | Real bank/card exports; one CSV = one account's transactions. Aggregator exports (Mint/YNAB) and a published PFI template are out of scope for v1. |
| Import target | User picks an existing non-demo account at the start of the flow, or creates one inline (regular `provider: "manual"` account). |
| Dedupe | Exact match, auto-skip, visible in preview. No fuzzy matching in v1. |
| Transfer detection | Conservative auto-pair (opposite direction, equal amount, ±3 days), shown in preview, individually un-flaggable before commit. |
| Categorization | Category-column value mapping when the file has one; otherwise direction defaults (inflow → `income`, outflow → `other`). Keyword/merchant heuristics deferred to a later slice. |
| Recovering from a bad import | Batch-level undo. No individual delete of imported rows (corrections go through `user_override`, like demo rows). |

## Architecture

**Approach: client-side parse, server-validated commit.** The raw file never leaves
the browser; only structured, validated rows are sent to a server action. No file
storage, no staging table. The server action is the trust boundary — everything the
client computed (mapping output, dedupe, transfer pairs) is advisory and re-checked
server-side.

Rejected alternatives: (a) server-side parse with an `import_staging` table — more
moving parts (migration, RLS, abandoned-staging cleanup, upload handling) for no v1
benefit at bank-export sizes; (b) one-shot server action without preview — guts the
preview/dedupe/transfer review this slice exists to provide.

### Module: `src/lib/csv-import/` (framework-free)

Same discipline as `financial-engine`: no React/Next imports, pure functions, fully
unit-tested, extractable to a package later.

- **`parse.ts`** — RFC-4180-ish parsing: quoted fields (embedded delimiters,
  escaped quotes, newlines in quotes), delimiter sniffing (`,` `;` tab), BOM strip,
  CRLF, ragged-row tolerance. Returns `{ headers, rows, errors }` with per-row error
  positions. Hand-rolled first; if implementation proves painful, `papaparse` may be
  adopted but must stay isolated inside this module.
- **`detect.ts`** — header auto-detection. Proposes a `ColumnMapping` from common
  bank header names (date/posted/transaction date; description/payee/memo;
  amount, or debit + credit pair; category). Also infers a proposed date format and
  sign convention from sample values. Proposals only — the user confirms every
  mapping in the UI.
- **`normalize.ts`** — applies a confirmed `ColumnMapping` to raw rows →
  `NormalizedRow[]`: `postedDate` (ISO `yyyy-mm-dd`), `amount` (≥ 0, two decimals) +
  `direction`, trimmed `description`, `category` (via the value-mapping table, else
  direction default). Handles date formats (`mdy`/`dmy`/`ymd`, 2- and 4-digit
  years), amount syntaxes (thousands separators, leading currency symbols,
  parentheses-negative, explicit debit/credit columns), and collects per-row errors
  (unparseable date/amount, empty description) without aborting the file.
- **`dedupe.ts`** — canonical duplicate key:
  `accountId + postedDate + amount + direction + foldedDescription` (description
  case-folded, whitespace-collapsed). Marks rows duplicate against existing
  transactions on the target account **and** against earlier rows in the same file.
  Duplicates are skipped at commit, never silently: they are counted and listed in
  the preview.
- **`transfers.ts`** — conservative pairing. A candidate pair is: opposite
  direction, equal amount, posted dates within ±3 days, other side on a *different*
  account of the same user (existing transaction) or elsewhere in the same batch.
  Each row participates in at most one pair (greedy nearest-date match;
  deterministic tie-break by date then id). Emits proposed pairs for the preview.

### Data model — migration `0004_csv_import`

- `transactions.import_batch_id uuid` (nullable) + index on `(user_id, import_batch_id)`.
- `import_batch_id` is written at insert and never updated: it joins the protected
  set in the 0002 source-immutability trigger.
- **No `import_batches` table.** Batch summaries (row count, date span, imported-at
  via `created_at`) are derived by grouping on `import_batch_id`. A table becomes
  worthwhile only with later features (e.g. saved per-account mappings).

**Row provenance:** `import_batch_id IS NOT NULL` ⇒ CSV-imported. Such rows get the
existing correction UI (`user_override`) but no individual delete — same posture as
demo rows. Manual rows are unchanged.

**Transfer pairing vs. immutability:** `is_transfer`/`transfer_pair_id` are written
at insert time (pairs resolved before insert), so no post-insert source-column
mutation is needed. When a pair's other side is an *existing* row, the pair is
recorded on the new row only; the existing row is never mutated. The engine counts
a transfer resolved when `transfer_pair_id` is non-null, so the new row is resolved;
an existing row that was already `is_transfer` with no pair stays unresolved and
keeps its (accurate) confidence penalty. Un-flagging a wrongly-detected transfer
after commit is a `user_override` correction like any other.

### Server actions

`importTransactions(input)` — new `src/app/actions/imports.ts`, following the
existing `MutationResult` conventions:

1. **Validate:** Zod — `{ accountId, rows: NormalizedRow[] (≤ 10 000), transferPairs }`;
   per-row ISO date, amount ≥ 0 with ≤ 2 decimals, direction enum, category from
   `CATEGORIES`, description length bounds.
2. **Authorize:** account exists, owned by caller (RLS plus explicit check, as in
   existing actions), `provider !== "demo"`.
3. **Re-check:** dedupe re-run against current DB state (stale-client/race guard);
   transfer pairs re-validated against the same criteria as `transfers.ts`.
4. **Insert:** one generated `import_batch_id`; `insertChunked` reuse. On any chunk
   failure: delete the batch's rows (server-side rollback) and return `{ error }` —
   commit is all-or-nothing from the user's view.
5. **Finish:** `finishWithRebuild` (shared snapshot rebuild + revalidation), same as
   every balance-affecting action.

`undoImport(batchId)` — ownership check → delete
`where user_id = auth.uid() and import_batch_id = batchId` → `finishWithRebuild`.

### UI — `/import` route

Mobile-first stepper (full-width cards at ~390 px; desktop adapts):

1. **Upload & target.** Target-account picker (non-demo accounts; "New account…"
   opens the existing account form inline) + file input (tap to pick; drag-drop as
   desktop enhancement). Guards: extension check, ~5 MB / 10 000-row cap,
   empty-file and no-recognizable-columns errors with plain-language recovery copy.
2. **Map columns.** Dropdown per field — date, description, amount *or*
   debit + credit — pre-filled from `detect.ts` with a "detected from your file's
   headers" note. Date-format and sign-convention pickers each show a live example
   row rendered both ways ("Is `03/04/2025` March 4 or April 3?"). If a category
   column is mapped: value-mapping table (bank value → PFI category dropdown;
   unmapped values fall back to direction defaults).
3. **Preview.** Summary chips: **N new · N duplicates skipped · N transfer pairs ·
   N rows with errors** — each expandable to its row list. Transfer pairs are
   individually un-flaggable (toggle; never color-only state). Error rows are
   listed with reasons and excluded from commit — never silently dropped. Inline
   explainers: "Why was this skipped?", "Why is this a transfer?" (same
   explainability posture as the score screen).
4. **Commit → Summary.** Progress state while the action runs. Summary: rows
   imported, per-category counts, duplicates/errors skipped, a prominent
   **Undo this import**, links to `/transactions` (pre-filtered to the batch's
   account and date span) and `/score`.

**Entry points:** "Import CSV" on `/accounts`; the dashboard empty state (the
"replace demo data" moment). `/accounts` gains a derived **Recent imports** list
with per-batch undo (two-step in-app confirm, matching the delete idiom).

**States:** every step handles loading/empty/error. A failed commit returns to the
intact preview (no re-mapping). Chunk-failure rollback makes partial success
impossible from the user's view.

**Accessibility:** stepper keyboard-navigable; file input has a visible labeled
button (not drop-zone-only); duplicate/transfer/error states communicated with
text + icons, never color alone.

## Privacy & analytics

The raw file is parsed in-browser and never uploaded or stored. Only normalized
rows reach the server. Product analytics may record step progression and aggregate
counts only — never descriptions, amounts, merchant strings, or file contents
(binding analytics rule).

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Unreadable/empty file, no recognizable columns | Step-1 error with recovery copy; nothing leaves the browser. |
| Per-row parse errors (bad date/amount) | Row listed in preview with reason, excluded from commit; rest of file imports. |
| All rows duplicates | Preview states it plainly; commit disabled ("Nothing new to import"). |
| Commit validation/authorization failure | `{ error }` surfaced; preview intact. |
| Chunked-insert partial failure | Server deletes the batch's rows; user sees a single retryable error. |
| Bad import discovered post-commit | Undo on summary screen or `/accounts` Recent imports; rebuild restores prior state. |

## Testing

- **Unit (bulk of coverage), `src/lib/csv-import/*.test.ts`:** parse (quotes, BOM,
  delimiters, CRLF, ragged rows); detect (real-world header fixtures: Chase, Amex,
  generic debit/credit); normalize (ambiguous `03/04/2025` under both formats, sign
  conventions, parentheses-negative, thousands separators, 2-digit years); dedupe
  (existing + intra-file, near-miss non-duplicates differing by one cent/day);
  transfers (±3-day boundary, no double-pairing, batch-internal and
  batch-vs-existing pairs).
- **Validation:** Zod schema tests following `validation/transactions.test.ts`.
- **RLS:** extend `scripts/test-rls.mts` — cross-user import into a foreign account
  denied; cross-user `undoImport` denied.
- **Live QA (final task):** real browser at 390×844 and 1280×900 with fixture CSVs —
  full happy path, re-import of the same file (all-duplicates), transfer pair
  detection + un-flag, error-row file, undo, and score/report reflecting imported
  data.

## Out of scope (v1)

- Fuzzy/date-drift dedupe; keyword/merchant categorization heuristics; saved
  per-account mappings (`import_batches` table); aggregator (Mint/YNAB) multi-account
  files; recurring detection (separate Phase 3 remainder); balance-anchor input at
  import time (current balances remain account-level, as today).
