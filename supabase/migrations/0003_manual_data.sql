-- Manual-data slice: accounts are archived, never deleted, so their
-- transaction history keeps informing snapshots built before the archive date
-- stays queryable. Archived accounts are excluded from calculations and
-- pickers at the application layer.
alter table public.financial_accounts
  add column archived_at timestamptz;
