-- PDF statement import: shared import batches, private statement storage,
-- staged metadata/transactions, and owner-only access.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  source_type text not null check (source_type in ('csv', 'pdf', 'manual', 'connected_account')),
  status text not null default 'uploaded' check (
    status in ('uploaded', 'extracting', 'ready_for_review', 'needs_review', 'unsupported', 'failed', 'confirmed', 'cancelled')
  ),
  original_filename text,
  storage_path text,
  file_sha256 text,
  detected_institution text,
  detected_account_type text check (
    detected_account_type is null or detected_account_type in ('checking', 'savings', 'credit_card')
  ),
  statement_start_date date,
  statement_end_date date,
  parser_version text,
  extraction_method text check (
    extraction_method is null or extraction_method in ('native_text', 'layout_text', 'institution_adapter', 'ocr', 'ai_assisted')
  ),
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  validation_results jsonb not null default '[]',
  reconciliation_results jsonb,
  confirmed_at timestamptz,
  failure_reason text,
  unsupported_reason text,
  created_at timestamptz not null default now()
);

create index import_batches_user_created_idx on public.import_batches (user_id, created_at desc);
create index import_batches_user_source_idx on public.import_batches (user_id, source_type, status);
create unique index import_batches_user_pdf_hash_active_idx
  on public.import_batches (user_id, file_sha256)
  where source_type = 'pdf' and file_sha256 is not null and status <> 'cancelled';

create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  import_batch_id uuid not null references public.import_batches (id) on delete cascade,
  bucket_id text not null default 'statement-pdfs',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  page_count integer check (page_count is null or page_count > 0),
  file_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (bucket_id, storage_path)
);

create index import_files_user_hash_idx on public.import_files (user_id, file_sha256);

create table public.staged_statement_metadata (
  import_batch_id uuid primary key references public.import_batches (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  institution text,
  account_name text,
  account_type text check (account_type is null or account_type in ('checking', 'savings', 'credit_card')),
  masked_account_number text,
  statement_start_date date,
  statement_end_date date,
  beginning_balance numeric(14,2),
  ending_balance numeric(14,2),
  available_balance numeric(14,2),
  credit_limit numeric(14,2),
  minimum_payment numeric(14,2),
  payment_due_date date,
  raw_text_excerpt text,
  parser_metadata jsonb not null default '{}',
  field_confidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.staged_transactions (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  posted_date date,
  transaction_date date,
  description text,
  amount numeric(14,2),
  direction text check (direction is null or direction in ('inflow', 'outflow')),
  category text,
  reference_number text,
  source_page integer,
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  field_confidence jsonb not null default '{}',
  issues jsonb not null default '[]',
  excluded boolean not null default false,
  duplicate_of_transaction_id uuid references public.transactions (id) on delete set null,
  original_values jsonb not null default '{}',
  corrected_values jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index staged_transactions_import_idx on public.staged_transactions (import_batch_id, id);
create index staged_transactions_user_idx on public.staged_transactions (user_id, import_batch_id);

create table public.import_corrections (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches (id) on delete cascade,
  staged_transaction_id uuid references public.staged_transactions (id) on delete set null,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  correction_type text not null,
  original_value jsonb,
  corrected_value jsonb,
  created_at timestamptz not null default now()
);

create index import_corrections_import_idx on public.import_corrections (import_batch_id, created_at);

alter table public.import_batches enable row level security;
alter table public.import_files enable row level security;
alter table public.staged_statement_metadata enable row level security;
alter table public.staged_transactions enable row level security;
alter table public.import_corrections enable row level security;

create policy "own_select" on public.import_batches for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.import_batches for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.import_batches for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.import_batches for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own_select" on public.import_files for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.import_files for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.import_files for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.import_files for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own_select" on public.staged_statement_metadata for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.staged_statement_metadata for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.staged_statement_metadata for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.staged_statement_metadata for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own_select" on public.staged_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.staged_transactions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.staged_transactions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.staged_transactions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own_select" on public.import_corrections for select to authenticated using ((select auth.uid()) = user_id);
create policy "own_insert" on public.import_corrections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own_update" on public.import_corrections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.import_corrections for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.import_batches to authenticated;
grant select, insert, update, delete on public.import_files to authenticated;
grant select, insert, update, delete on public.staged_statement_metadata to authenticated;
grant select, insert, update, delete on public.staged_transactions to authenticated;
grant select, insert, update, delete on public.import_corrections to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statement-pdfs', 'statement-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf'];

create policy "statement_pdf_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'statement-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "statement_pdf_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'statement-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "statement_pdf_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'statement-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'statement-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "statement_pdf_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'statement-pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
