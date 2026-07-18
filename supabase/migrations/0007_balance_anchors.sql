-- 0007_balance_anchors.sql
-- Statement balance anchoring (docs/superpowers/specs/2026-07-18-balance-anchoring-design.md).
-- One row per anchoring event — a statement's ending balance entered at
-- import, or a manual balance edit. Append-only provenance: app code never
-- updates rows, and deletes only via batch undo removing its own anchor.
-- The engine trusts the "effective anchor" (greatest anchor_date, tiebreak
-- created_at); discrepancy records the reconciliation result at creation
-- (null = no prior anchor to reconcile against, 0 = clean).

create table public.balance_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  account_id uuid not null references public.financial_accounts (id) on delete cascade,
  anchor_date date not null,
  balance numeric(14,2) not null,
  source text not null check (source in ('manual', 'import')),
  import_batch_id uuid,
  discrepancy numeric(14,2),
  created_at timestamptz not null default now()
);

create index balance_anchors_account_idx on public.balance_anchors (account_id, anchor_date desc);

alter table public.balance_anchors enable row level security;

create policy "own_select" on public.balance_anchors for select using (auth.uid() = user_id);
create policy "own_insert" on public.balance_anchors for insert with check (auth.uid() = user_id);
create policy "own_update" on public.balance_anchors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.balance_anchors for delete using (auth.uid() = user_id);

-- Staleness-nudge dismissal (docs spec §4): cleared implicitly by fresh data,
-- re-shown 35 days after dismissal while still stale.
alter table public.user_profiles
  add column stale_nudge_dismissed_at timestamptz;
