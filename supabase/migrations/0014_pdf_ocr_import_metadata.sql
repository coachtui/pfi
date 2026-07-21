-- OCR support for PDF statement imports. Keeps OCR as an extraction method
-- inside the existing import_batches lifecycle and owner-scoped import model.

alter table public.import_batches
  drop constraint if exists import_batches_status_check,
  add constraint import_batches_status_check check (
    status in ('uploaded', 'extracting', 'ocr_processing', 'ready_for_review', 'needs_review', 'unsupported', 'failed', 'confirmed', 'cancelled')
  );

alter table public.import_batches
  drop constraint if exists import_batches_extraction_method_check,
  add constraint import_batches_extraction_method_check check (
    extraction_method is null or extraction_method in ('native_text', 'layout_text', 'institution_adapter', 'ocr', 'hybrid', 'ai_assisted')
  );

alter table public.import_batches
  add column if not exists ocr_provider text,
  add column if not exists ocr_provider_version text,
  add column if not exists ocr_average_confidence numeric(5,2),
  add column if not exists ocr_started_at timestamptz,
  add column if not exists ocr_completed_at timestamptz,
  add column if not exists ocr_failure_code text check (
    ocr_failure_code is null or ocr_failure_code in (
      'ocr_not_configured',
      'pdf_render_failed',
      'ocr_provider_failed',
      'ocr_timeout',
      'ocr_low_quality',
      'no_statement_data_detected',
      'unsupported_statement_type',
      'multiple_accounts_detected',
      'password_protected',
      'corrupted_pdf',
      'page_limit_exceeded',
      'file_limit_exceeded',
      'parser_failed'
    )
  ),
  add column if not exists ocr_failure_detail text,
  add column if not exists native_text_page_count integer check (native_text_page_count is null or native_text_page_count >= 0),
  add column if not exists ocr_page_count integer check (ocr_page_count is null or ocr_page_count >= 0),
  add column if not exists processing_retry_count integer not null default 0 check (processing_retry_count >= 0);

create index if not exists import_batches_user_ocr_status_idx
  on public.import_batches (user_id, status, ocr_failure_code)
  where source_type = 'pdf';
