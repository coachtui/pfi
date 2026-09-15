-- 0016_derived_events.sql
-- Plaid Slice 2 (docs/superpowers/specs/2026-09-15-plaid-slice2-production-and-derived-events-design.md §2a,
-- DECISIONS #44). Driver events become a stored, sourced, versioned derivation:
-- the demo loader's authored rows keep source = 'demo'; deterministic rows
-- derived from a household's own transactions carry source = 'derived', the
-- transaction they explain, and the rule version that produced them. Derived
-- rows are replaced wholesale on every rebuild (like daily_snapshots).

alter table public.financial_events
  add column source text not null default 'demo' check (source in ('demo', 'derived')),
  add column transaction_id uuid references public.transactions (id) on delete cascade,
  add column derivation_version text;

-- One derived event per (transaction, type): re-derivation is idempotent.
create unique index financial_events_derived_txn_idx
  on public.financial_events (user_id, transaction_id, type)
  where source = 'derived' and transaction_id is not null;

create index financial_events_user_source_idx on public.financial_events (user_id, source);

-- A derived event may only reference the same user's transaction (mirrors the
-- balance_anchors ownership trigger, DECISIONS #25: RLS + FK alone do not stop
-- a forged cross-tenant transaction_id on an owner-inserted row).
create function public.financial_events_check_transaction_ownership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.transaction_id is not null and not exists (
    select 1 from public.transactions t
    where t.id = new.transaction_id and t.user_id = new.user_id
  ) then
    raise exception 'financial_events: transaction_id does not belong to user_id';
  end if;
  return new;
end;
$$;

create trigger financial_events_transaction_ownership
  before insert or update on public.financial_events
  for each row
  execute function public.financial_events_check_transaction_ownership();

-- Carry-over from Slice 1 (KNOWN_LIMITATIONS "Newly linked accounts show —"):
-- when a sync anchor lands for an account that has no balance yet (an account
-- created in the same commit), seed current_balance from the anchor so the
-- page never shows an em-dash in the window before the rebuild rolls it forward.
create function public.balance_anchors_seed_account_balance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source = 'sync' then
    update public.financial_accounts
      set current_balance = new.balance
      where id = new.account_id and user_id = new.user_id and current_balance is null;
  end if;
  return new;
end;
$$;

create trigger balance_anchors_seed_account_balance
  after insert on public.balance_anchors
  for each row
  execute function public.balance_anchors_seed_account_balance();
