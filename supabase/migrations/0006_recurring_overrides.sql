-- 0006_recurring_overrides.sql
-- Recurring detection slice (docs/superpowers/specs/2026-07-18-recurring-detection-design.md).
-- Detection is recomputed from transactions on every rebuild; only user
-- intent (confirm/dismiss of a detected series) is persisted, mirroring how
-- corrections stay in transactions.user_override.

create table public.recurring_overrides (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  series_key text not null,
  status text not null check (status in ('confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, series_key)
);

alter table public.recurring_overrides enable row level security;

create policy "own_select" on public.recurring_overrides for select using (auth.uid() = user_id);
create policy "own_insert" on public.recurring_overrides for insert with check (auth.uid() = user_id);
create policy "own_update" on public.recurring_overrides for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.recurring_overrides for delete using (auth.uid() = user_id);

-- transactions.recurring_status (0001) was reserved for per-transaction
-- recurrence tagging and never read or written; series-level detection
-- supersedes it. The immutability trigger references the column, so the
-- function is recreated without it BEFORE the drop.

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

alter table public.transactions drop column recurring_status;
