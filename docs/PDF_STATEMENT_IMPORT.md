# PDF Statement Import

PFI supports statement PDF import as a fallback when CSV export is unavailable. CSV remains the preferred path for accurate transaction history. PDF data is staged and must be reviewed before it can affect accounts, transactions, snapshots, reports, or the Personal Index.

## Supported Statements

Phase 1 supports fictional/sanitized examples and real statements for:

- Checking
- Savings
- Credit cards

Unsupported in this phase:

- Brokerage, investment, retirement, tax-lot, options, mortgage escrow, and multi-account statements
- Password-protected PDFs
- Corrupted PDFs
- Scanned/image-only statements when OCR dependencies are not configured or OCR quality is too low

## Privacy And Retention

Uploaded PDFs are stored in the private `statement-pdfs` Supabase Storage bucket. Object paths begin with the authenticated user's id, and storage policies only allow that owner to select, insert, update, or delete their objects. No public URLs are created.

The database stores import metadata, a short raw-text excerpt for debugging, parser metadata, OCR metadata, validation results, staged rows, and correction/audit rows. Application code must not log full statement text, full account numbers, rendered page images, raw OCR responses, or unmasked financial details.

Cancelled imports remove the stored object and mark the batch `cancelled`. Failed imports retain status and diagnostic metadata so the UI can show a precise failure reason; retention cleanup can be added as a scheduled job later.

## Architecture

PDF parsing lives under `src/lib/pdf-import`:

- `validate.ts`: MIME, extension, size, page count, empty/corrupt, encrypted-PDF checks
- `extract.ts`: native embedded text extraction, including simple uncompressed and Flate streams
- `ocr.ts`: server-only OCR provider implementation
- `ocr-utils.ts`: OCR layout/text normalization and safe failure messages
- `registry.ts`: parser adapter registry
- `parse.ts`: generic checking/savings/credit-card parser and classifier
- `reconcile.ts` behavior is currently implemented in `parse.ts` through `reconcileStatement`
- `dedupe.ts`: file SHA-256 and transaction duplicate helpers
- `money.ts`: cent-based arithmetic helpers

The server actions in `src/app/actions/imports.ts` store PDFs privately, stage extracted metadata/transactions, and confirm reviewed rows through the same normalized transaction commit path used by CSV imports.

To add an institution adapter, implement `ParserAdapter`, add a deterministic `supports(text)` detector, parse only fields present in the statement, and register it before the generic adapter. Adapter output must remain normalized to staged statement metadata and staged transactions.

## OCR

Native embedded text extraction always runs first. OCR triggers only when the extracted text is empty or below the usable-text threshold. OCR is an extraction method in the existing PDF importer, not a separate subsystem:

`PDF -> native extraction or OCR -> parser registry -> normalized statement model -> reconciliation -> confidence -> staging -> review -> confirmation`

The current provider is `local-tesseract`:

- Rendering: `pdfjs-dist` + `@napi-rs/canvas` in-process server rendering
- OCR: `tesseract.js`
- Default DPI: `250`
- Default max rendered page dimension: `3200`
- Default OCR timeout: `90000` ms
- Temporary files: private OS temp directory, deleted after processing

Environment/configuration:

- `PDF_IMPORT_RENDER_COMMAND`: optional path/name for a Poppler renderer fallback. Leave unset to use the Vercel-compatible pdf.js/canvas renderer.
- `PDF_IMPORT_OCR_DPI`: optional OCR render DPI
- `PDF_IMPORT_OCR_MAX_DIMENSION`: optional max image dimension
- `PDF_IMPORT_RENDER_TIMEOUT_MS`: optional render timeout
- `PDF_IMPORT_OCR_TIMEOUT_MS`: optional total OCR timeout
- `PDF_IMPORT_OCR_LANG_PATH`: optional Tesseract language-data path
- `PDF_IMPORT_OCR_CACHE_PATH`: optional Tesseract cache path

No external OCR provider is used by default and statement images are not sent to an external service. Production must include the Node canvas native package and allow `tesseract.js` worker/wasm/language assets. The language assets should be pinned locally through `PDF_IMPORT_OCR_LANG_PATH` for restricted network environments. If rendering or OCR is unavailable, the import fails safely with `ocr_not_configured`, `pdf_render_failed`, `ocr_provider_failed`, or `ocr_timeout`.

OCR-derived imports are forced into review (`needs_review`) even when parsing succeeds. The review screen displays an OCR notice, provider name, average confidence, extraction notes, reconciliation, duplicate warnings, and editable staged transactions.

## Reconciliation

Deposit statements use:

`beginning balance + credits - debits/fees = ending balance`

Credit-card statements use:

`previous balance + purchases/fees/interest - payments/credits = new balance`

The implementation uses integer cents, not floating-point arithmetic. Results are:

- `reconciled`
- `reconciled_within_tolerance`
- `not_enough_information`
- `does_not_reconcile`

A non-reconciling statement is not silently blocked, but it is forced into a visible review state.

## Confidence

Import confidence is `high`, `medium`, or `low`. Field confidence flags uncertain dates, amounts, direction, ending balance, and account identification. High confidence only means parser patterns and validation checks matched; it is not independent verification.

OCR-derived imports do not default to high confidence. The generic parser caps OCR imports at medium when they otherwise parse cleanly, and marks OCR-derived transaction amounts for review. OCR quality below the configured threshold fails extraction instead of staging unreliable rows.

## Testing

Use sanitized fixtures only. Do not commit real statements. Tests currently cover validation, native text extraction, OCR normalization, OCR failure mapping, statement classification, deposit and credit-card parsing, date/amount normalization through shared CSV helpers, debit/credit direction, reconciliation, confidence, duplicate document hashes, transaction dedupe overlap, and unsupported statement detection.
