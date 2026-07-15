-- PFI integrity guards.
-- 1. Transaction source columns are immutable after insert; corrections belong in
--    user_override (and free-text notes). This enforces "source of truth" provenance:
--    downstream consumers can trust that posted_date/amount/direction/etc. reflect what
--    was originally ingested, while still allowing user corrections via the override.
-- 2. Every transaction must reference an account owned by the same user_id. Because the
--    check function runs SECURITY INVOKER (the default), it is subject to RLS on
--    financial_accounts, so a forged account_id belonging to another user is invisible
--    to the query and the exists() check fails naturally -- no need to duplicate
--    auth.uid() logic here.
-- 3. Baseline data-quality constraints + an index to support account-scoped lookups.

create function public.transactions_prevent_source_update()
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
  ) then
    raise exception 'transactions: source columns are immutable after insert; corrections must go in user_override';
  end if;

  return new;
end;
$$;

create trigger transactions_immutable_source
  before update on public.transactions
  for each row
  execute function public.transactions_prevent_source_update();

create function public.transactions_check_account_ownership()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.financial_accounts a
    where a.id = new.account_id
      and a.user_id = new.user_id
  ) then
    raise exception 'transactions: account_id does not belong to user_id';
  end if;

  return new;
end;
$$;

create trigger transactions_account_ownership
  before insert or update on public.transactions
  for each row
  execute function public.transactions_check_account_ownership();

alter table public.financial_events
  add constraint financial_events_amount_nonneg check (amount >= 0);

alter table public.transactions
  add constraint transactions_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1));

create index transactions_account_idx on public.transactions (account_id);
