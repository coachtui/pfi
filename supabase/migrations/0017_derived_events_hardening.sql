-- Plaid Slice 2 follow-up (DECISIONS #44, database review): harden the
-- financial_events provenance columns added in 0016.
--
-- 1. Index the transaction_id foreign key. The RI cascade on a transaction
--    delete runs "delete from financial_events where transaction_id = $1"
--    once per deleted row; without an index that is a full scan of a shared
--    table per row (demo clear ~1,000 rows, delete_connected_item_data
--    thousands, inside one transaction).
-- 2. Provenance check: a derived row always carries its transaction and
--    derivation version; a demo row never does.
-- 3. Narrow the (user_id, source) index to the only query that needs it —
--    the per-user delete of derived rows on every rebuild.
--
-- Fail fast rather than queue at the head of the lock line on transactions.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists financial_events_transaction_idx
  on public.financial_events (transaction_id)
  where transaction_id is not null;

alter table public.financial_events
  add constraint financial_events_derived_provenance check (
    (source = 'derived' and transaction_id is not null and derivation_version is not null)
    or (source = 'demo' and transaction_id is null and derivation_version is null)
  );

drop index if exists public.financial_events_user_source_idx;
create index if not exists financial_events_derived_user_idx
  on public.financial_events (user_id)
  where source = 'derived';
