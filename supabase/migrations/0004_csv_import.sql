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
