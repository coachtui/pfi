-- 0015_plaid_link_sync.sql
-- Plaid Link & Sync, Slice 1 (docs/superpowers/specs/2026-09-14-plaid-link-sync-slice1-design.md §1,
-- DECISIONS #43). Plaid is another import source: a new provider value, a
-- token vault readable only by the service role, provenance columns, and ONE
-- transactional commit function so cursor, rows, anchors, roster, and batch
-- status advance together or not at all.
--
-- Authorization model: `commit_connected_sync` / `delete_connected_item_data`
-- are SECURITY INVOKER (RLS applies to every statement inside) AND assert
-- explicit `auth.uid()` ownership over the batch, the Item, every account, and
-- every transaction they touch before writing. The transaction-local setting
-- `pfi.provider_write` only tells the immutability trigger that the current
-- statement is inside that audited path; it is an implementation detail, never
-- the authorization. `set_config` is unreachable through PostgREST (only
-- `public` is exposed) and only these two functions set it.

-- ---------------------------------------------------------------------------
-- 1. Enum widening
-- ---------------------------------------------------------------------------
alter table public.financial_accounts
  drop constraint financial_accounts_provider_check,
  add constraint financial_accounts_provider_check
    check (provider in ('demo', 'manual', 'csv', 'plaid'));

alter table public.balance_anchors
  drop constraint balance_anchors_source_check,
  add constraint balance_anchors_source_check
    check (source in ('manual', 'import', 'sync'));

-- ---------------------------------------------------------------------------
-- 2. Balance freshness provenance (spec principle 4: "synced" ≠ "live").
--    Existing rows: typed/statement values are neither cached nor realtime.
-- ---------------------------------------------------------------------------
alter table public.balance_anchors
  add column observed_at timestamptz not null default now(),
  add column source_updated_at timestamptz,
  add column freshness text not null default 'entered'
    check (freshness in ('entered', 'cached', 'realtime'));

-- ---------------------------------------------------------------------------
-- 3. plaid_items — one row per linked Item (institution login). Non-secret.
-- ---------------------------------------------------------------------------
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'initializing' check (status in (
    'initializing',       -- exchanged, no sync attempted yet
    'history_loading',    -- Plaid reports NOT_READY or INITIAL_UPDATE_COMPLETE
    'connected',          -- HISTORICAL_UPDATE_COMPLETE seen at least once
    'login_required',     -- ITEM_LOGIN_REQUIRED / consent expiring: Link update mode
    'error',              -- other ITEM_/INSTITUTION_ errors; error_code set
    'disconnect_pending', -- /item/remove failed; retryable, still billable
    'disconnected'        -- /item/remove succeeded
  )),
  update_status text,
  history_complete_at timestamptz,
  error_code text,
  transactions_cursor text,
  last_synced_at timestamptz,
  last_sync_attempt_at timestamptz,
  consent_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index plaid_items_user_idx on public.plaid_items (user_id, status);

alter table public.plaid_items enable row level security;

create policy "own_select" on public.plaid_items for select using ((select auth.uid()) = user_id);
create policy "own_insert" on public.plaid_items for insert with check ((select auth.uid()) = user_id);
create policy "own_update" on public.plaid_items for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own_delete" on public.plaid_items for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.plaid_items to authenticated;

-- ---------------------------------------------------------------------------
-- 4. plaid_item_secrets — service-role only. RLS enabled with NO policies and
--    NO grants to authenticated/anon: the browser client runs as the owner,
--    so owner-scoped RLS would still expose the token. App-layer AES-256-GCM
--    (src/lib/plaid/crypto.ts) on top; key_version supports rotation.
-- ---------------------------------------------------------------------------
create table public.plaid_item_secrets (
  plaid_item_id uuid primary key references public.plaid_items (id) on delete cascade,
  access_token_ciphertext text not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.plaid_item_secrets enable row level security;
revoke all on public.plaid_item_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. financial_accounts — Item linkage, roster status, per-Item uniqueness.
-- ---------------------------------------------------------------------------
alter table public.financial_accounts
  add column plaid_item_id uuid references public.plaid_items (id) on delete set null,
  add column external_account_id text,
  add column roster_status text
    check (roster_status is null or roster_status in ('shared', 'unshared', 'closed'));

create unique index financial_accounts_item_external_idx
  on public.financial_accounts (plaid_item_id, external_account_id)
  where plaid_item_id is not null and external_account_id is not null;

-- ---------------------------------------------------------------------------
-- 6. transactions — provider id (idempotent sync) and Plaid's *category*
--    confidence + raw taxonomy values, kept apart from PFI's own `confidence`.
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column external_id text,
  add column category_confidence text
    check (category_confidence is null or category_confidence in ('very_high', 'high', 'medium', 'low', 'unknown')),
  add column pfc_primary text,
  add column pfc_detailed text,
  add column category_taxonomy_version text
    check (category_taxonomy_version is null or category_taxonomy_version in ('v1', 'v2'));

create unique index transactions_external_idx
  on public.transactions (account_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- 7. import_batches — sync bookkeeping + post-commit rebuild flag.
-- ---------------------------------------------------------------------------
alter table public.import_batches
  add column plaid_item_id uuid references public.plaid_items (id) on delete set null,
  add column sync_metadata jsonb not null default '{}',
  add column rebuild_completed_at timestamptz;

create index import_batches_rebuild_pending_idx
  on public.import_batches (user_id)
  where source_type = 'connected_account' and status = 'confirmed' and rebuild_completed_at is null;

-- ---------------------------------------------------------------------------
-- 8. user_profiles — rebuild lease (token + timestamp) for dashboard-load repair.
-- ---------------------------------------------------------------------------
alter table public.user_profiles
  add column rebuild_claimed_at timestamptz,
  add column rebuild_claim_token uuid;

-- ---------------------------------------------------------------------------
-- 9. Immutability trigger (0002/0004/0006 — 0006 dropped recurring_status)
--    re-created: five new frozen columns, and
--    a provider-write mode that permits changes to the PROVIDER-OWNED set only
--    (spec §6) while `pfi.provider_write` names an in-flight
--    `connected_account` batch owned by the row's owner. Everything else stays
--    frozen even in provider mode. The mode is only ever set inside
--    commit_connected_sync / delete_connected_item_data, after their
--    ownership assertions.
-- ---------------------------------------------------------------------------
create or replace function public.transactions_prevent_source_update()
returns trigger
language plpgsql
as $$
declare
  v_flag text := current_setting('pfi.provider_write', true);
  v_provider_mode boolean := false;
begin
  if v_flag is not null and v_flag <> '' then
    -- Implementation detail, not authorization: the flag must name either a
    -- live sync batch (commit_connected_sync) or a Plaid Item
    -- (delete_connected_item_data) belonging to this row's owner. Both are
    -- RLS-visible reads under security invoker.
    select exists (
      select 1 from public.import_batches b
      where b.id::text = v_flag
        and b.user_id = old.user_id
        and b.source_type = 'connected_account'
        and b.status = 'extracting'
    ) or exists (
      select 1 from public.plaid_items i
      where i.id::text = v_flag
        and i.user_id = old.user_id
    ) into v_provider_mode;
  end if;

  -- Always frozen, in every mode.
  if (
    new.id is distinct from old.id
    or new.account_id is distinct from old.account_id
    or new.user_id is distinct from old.user_id
    or new.txn_type is distinct from old.txn_type
    or new.essential is distinct from old.essential
    or new.confidence is distinct from old.confidence
    or new.created_at is distinct from old.created_at
    or new.import_batch_id is distinct from old.import_batch_id
    or new.external_id is distinct from old.external_id
  ) then
    raise exception 'transactions: source columns are immutable after insert; corrections must go in user_override';
  end if;

  -- Provider-owned: frozen for users, rewritable only inside a live sync commit.
  if not v_provider_mode and (
    new.posted_date is distinct from old.posted_date
    or new.authorized_date is distinct from old.authorized_date
    or new.amount is distinct from old.amount
    or new.direction is distinct from old.direction
    or new.description is distinct from old.description
    or new.category is distinct from old.category
    or new.subcategory is distinct from old.subcategory
    or new.category_confidence is distinct from old.category_confidence
    or new.pfc_primary is distinct from old.pfc_primary
    or new.pfc_detailed is distinct from old.pfc_detailed
    or new.category_taxonomy_version is distinct from old.category_taxonomy_version
    or new.is_transfer is distinct from old.is_transfer
    or new.transfer_pair_id is distinct from old.transfer_pair_id
  ) then
    raise exception 'transactions: source columns are immutable after insert; corrections must go in user_override';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. commit_connected_sync — the ONLY writer of sync results. One transaction.
--
-- p_plan shape (built by src/lib/plaid/sync-plan.ts; account references are
-- Plaid external ids so first-sync inserts can target accounts created in the
-- same commit):
-- {
--   "item":     { "cursor": text, "update_status": text, "status": text,
--                 "history_complete": bool, "error_code": text|null },
--   "accounts": [ { "op": "create"|"archive"|"unarchive"|"keep",
--                   "external_account_id", "type", "display_name", "institution",
--                   "mask", "credit_limit", "roster_status" } ],
--   "deletes":  [ { "id": uuid } ],
--   "unpair_ids": [ uuid ],
--   "updates":  [ { "id": uuid, "posted_date", "authorized_date", "amount",
--                   "direction", "description", "category", "category_confidence",
--                   "pfc_primary", "pfc_detailed", "category_taxonomy_version",
--                   "unpair": bool, "pair_key": text|null } ],
--   "inserts":  [ { "external_account_id", "posted_date", "authorized_date",
--                   "amount", "direction", "description", "category",
--                   "category_confidence", "pfc_primary", "pfc_detailed",
--                   "category_taxonomy_version", "external_id",
--                   "pair_key": text|null } ],
--   "anchors":  [ { "external_account_id", "anchor_date", "balance",
--                   "observed_at", "source_updated_at", "freshness", "discrepancy" } ],
--   "reconciliation_results": jsonb, "sync_metadata": jsonb
-- }
-- pair_key: rows sharing a key (exactly two, across inserts and/or updates)
-- are linked as a transfer pair after inserts have ids.
-- ---------------------------------------------------------------------------
create or replace function public.commit_connected_sync(p_batch_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item_id uuid;
  v_ids uuid[];
  v_count int;
  v_inserted int := 0;
  v_updated int := 0;
  v_deleted int := 0;
  v_anchored int := 0;
  v_created_accounts int := 0;
  v_archived_accounts int := 0;
  v_pairs int := 0;
  v_now timestamptz := now();
  r record;
begin
  if v_uid is null then
    raise exception 'commit_connected_sync: not authenticated';
  end if;

  -- (a) Ownership assertions. RLS already hides foreign rows from a
  -- security-invoker function; the explicit user_id predicates and count
  -- equality checks make the authorization independent of that.
  select b.plaid_item_id into v_item_id
  from import_batches b
  where b.id = p_batch_id and b.user_id = v_uid
    and b.source_type = 'connected_account' and b.status = 'extracting';
  if v_item_id is null then
    raise exception 'commit_connected_sync: ownership (batch)';
  end if;

  if not exists (select 1 from plaid_items i where i.id = v_item_id and i.user_id = v_uid) then
    raise exception 'commit_connected_sync: ownership (item)';
  end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(coalesce(p_plan->'updates', '[]')) e;
  select count(*) into v_count from transactions t
    where t.id = any(v_ids) and t.user_id = v_uid;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'commit_connected_sync: ownership (updates)';
  end if;

  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(coalesce(p_plan->'deletes', '[]')) e;
  select count(*) into v_count from transactions t
    where t.id = any(v_ids) and t.user_id = v_uid;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'commit_connected_sync: ownership (deletes)';
  end if;

  select coalesce(array_agg(e::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p_plan->'unpair_ids', '[]')) e;
  select count(*) into v_count from transactions t
    where t.id = any(v_ids) and t.user_id = v_uid;
  if v_count <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'commit_connected_sync: ownership (unpair)';
  end if;

  -- (b) Provider-write mode, transaction-local, scoped to this batch.
  perform set_config('pfi.provider_write', p_batch_id::text, true);

  -- (c) Roster.
  for r in select * from jsonb_to_recordset(coalesce(p_plan->'accounts', '[]')) as x(
    op text, external_account_id text, type text, display_name text, institution text,
    mask text, credit_limit numeric, roster_status text)
  loop
    if r.op = 'create' then
      insert into financial_accounts (
        user_id, provider, plaid_item_id, external_account_id, type, display_name,
        institution, mask, credit_limit, roster_status, connection_status, last_synced_at)
      values (
        v_uid, 'plaid', v_item_id, r.external_account_id, r.type, r.display_name,
        r.institution, r.mask, r.credit_limit, coalesce(r.roster_status, 'shared'), 'ok', v_now)
      on conflict (plaid_item_id, external_account_id) where plaid_item_id is not null and external_account_id is not null
      do update set archived_at = null, roster_status = 'shared', connection_status = 'ok', last_synced_at = excluded.last_synced_at;
      v_created_accounts := v_created_accounts + 1;
    elsif r.op = 'archive' then
      update financial_accounts
        set archived_at = coalesce(archived_at, v_now), roster_status = coalesce(r.roster_status, 'unshared')
        where plaid_item_id = v_item_id and external_account_id = r.external_account_id and user_id = v_uid;
      v_archived_accounts := v_archived_accounts + 1;
    elsif r.op = 'unarchive' then
      update financial_accounts
        set archived_at = null, roster_status = 'shared'
        where plaid_item_id = v_item_id and external_account_id = r.external_account_id and user_id = v_uid;
    elsif r.op = 'keep' then
      update financial_accounts
        set display_name = coalesce(r.display_name, display_name),
            mask = coalesce(r.mask, mask),
            credit_limit = coalesce(r.credit_limit, credit_limit)
        where plaid_item_id = v_item_id and external_account_id = r.external_account_id and user_id = v_uid;
    else
      raise exception 'commit_connected_sync: unknown roster op %', r.op;
    end if;
  end loop;

  -- (d) Deletes (provider retractions). Audit lives in reconciliation_results.
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_ids
  from jsonb_array_elements(coalesce(p_plan->'deletes', '[]')) e;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    -- Survivors of a deleted transfer counterpart lose their pairing.
    update transactions set is_transfer = false, transfer_pair_id = null
      where transfer_pair_id = any(v_ids) and user_id = v_uid;
    delete from transactions where id = any(v_ids) and user_id = v_uid;
    get diagnostics v_deleted = row_count;
  end if;

  -- (e) Explicit unpairs (provider amount/date/direction changed on a paired row).
  select coalesce(array_agg(e::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p_plan->'unpair_ids', '[]')) e;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    update transactions set is_transfer = false, transfer_pair_id = null
      where id = any(v_ids) and user_id = v_uid;
  end if;

  -- (f) Provider-column updates. User-owned columns are not in this statement.
  for r in select * from jsonb_to_recordset(coalesce(p_plan->'updates', '[]')) as x(
    id uuid, posted_date date, authorized_date date, amount numeric, direction text,
    description text, category text, category_confidence text, pfc_primary text,
    pfc_detailed text, category_taxonomy_version text, unpair boolean)
  loop
    update transactions set
      posted_date = r.posted_date,
      authorized_date = r.authorized_date,
      amount = r.amount,
      direction = r.direction,
      description = r.description,
      category = r.category,
      category_confidence = r.category_confidence,
      pfc_primary = r.pfc_primary,
      pfc_detailed = r.pfc_detailed,
      category_taxonomy_version = r.category_taxonomy_version,
      is_transfer = case when coalesce(r.unpair, false) then false else is_transfer end,
      transfer_pair_id = case when coalesce(r.unpair, false) then null else transfer_pair_id end
    where id = r.id and user_id = v_uid;
    v_updated := v_updated + 1;
  end loop;

  -- (g) Inserts. Idempotent via the partial unique index; pair keys captured
  -- so pairing can run once ids exist.
  create temp table if not exists sync_pairs (pair_key text, txn_id uuid) on commit drop;
  delete from sync_pairs;

  for r in select * from jsonb_to_recordset(coalesce(p_plan->'inserts', '[]')) as x(
    external_account_id text, posted_date date, authorized_date date, amount numeric,
    direction text, description text, category text, category_confidence text,
    pfc_primary text, pfc_detailed text, category_taxonomy_version text,
    external_id text, pair_key text)
  loop
    with ins as (
      insert into transactions (
        account_id, user_id, posted_date, authorized_date, amount, direction, description,
        category, category_confidence, pfc_primary, pfc_detailed, category_taxonomy_version,
        external_id, import_batch_id)
      select a.id, v_uid, r.posted_date, r.authorized_date, r.amount, r.direction, r.description,
             r.category, r.category_confidence, r.pfc_primary, r.pfc_detailed, r.category_taxonomy_version,
             r.external_id, p_batch_id
      from financial_accounts a
      where a.plaid_item_id = v_item_id and a.external_account_id = r.external_account_id and a.user_id = v_uid
      on conflict (account_id, external_id) where external_id is not null do nothing
      returning id
    )
    insert into sync_pairs (pair_key, txn_id)
    select r.pair_key, ins.id from ins where r.pair_key is not null;
    get diagnostics v_count = row_count;
    -- row_count here counts sync_pairs rows; recount inserted rows by batch below.
  end loop;
  select count(*) into v_inserted from transactions t where t.import_batch_id = p_batch_id and t.user_id = v_uid;

  -- Existing rows that take part in a pair with a new row.
  insert into sync_pairs (pair_key, txn_id)
  select e->>'pair_key', (e->>'id')::uuid
  from jsonb_array_elements(coalesce(p_plan->'updates', '[]')) e
  where e->>'pair_key' is not null;

  -- (h) Pairing: exactly two rows per key, both owned by the caller.
  for r in
    select pair_key, array_agg(txn_id) as ids
    from sync_pairs
    group by pair_key
    having count(*) = 2
  loop
    update transactions set is_transfer = true, transfer_pair_id = r.ids[2]
      where id = r.ids[1] and user_id = v_uid;
    update transactions set is_transfer = true, transfer_pair_id = r.ids[1]
      where id = r.ids[2] and user_id = v_uid;
    v_pairs := v_pairs + 1;
  end loop;

  -- (i) Anchors (source 'sync', cached freshness). Ownership trigger (0008)
  -- re-checks account ownership on every row.
  insert into balance_anchors (
    user_id, account_id, anchor_date, balance, source, import_batch_id, discrepancy,
    observed_at, source_updated_at, freshness)
  select v_uid, a.id, x.anchor_date, x.balance, 'sync', p_batch_id, x.discrepancy,
         coalesce(x.observed_at, v_now), x.source_updated_at, coalesce(x.freshness, 'cached')
  from jsonb_to_recordset(coalesce(p_plan->'anchors', '[]')) as x(
    external_account_id text, anchor_date date, balance numeric, observed_at timestamptz,
    source_updated_at timestamptz, freshness text, discrepancy numeric)
  join financial_accounts a
    on a.plaid_item_id = v_item_id and a.external_account_id = x.external_account_id and a.user_id = v_uid;
  get diagnostics v_anchored = row_count;

  -- (j) Item bookkeeping. history_complete_at is set once, never cleared.
  update plaid_items set
    transactions_cursor = coalesce(p_plan->'item'->>'cursor', transactions_cursor),
    update_status = p_plan->'item'->>'update_status',
    status = coalesce(p_plan->'item'->>'status', status),
    error_code = p_plan->'item'->>'error_code',
    history_complete_at = case
      when history_complete_at is null and coalesce((p_plan->'item'->>'history_complete')::boolean, false) then v_now
      else history_complete_at end,
    last_synced_at = v_now
  where id = v_item_id and user_id = v_uid;

  -- (k) Mirror onto the Item's accounts so account-level UI needs no join.
  update financial_accounts set
    connection_status = case
      when (p_plan->'item'->>'status') in ('login_required', 'error') then p_plan->'item'->>'status'
      else 'ok' end,
    last_synced_at = v_now
  where plaid_item_id = v_item_id and user_id = v_uid;

  -- (l) Batch confirmed with audit + metadata. Cursor and rows are now consistent.
  update import_batches set
    status = 'confirmed',
    confirmed_at = v_now,
    reconciliation_results = coalesce(p_plan->'reconciliation_results', '{}'::jsonb),
    sync_metadata = coalesce(p_plan->'sync_metadata', '{}'::jsonb)
      || jsonb_build_object('counts', jsonb_build_object(
           'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted,
           'anchored', v_anchored, 'accounts_created', v_created_accounts,
           'accounts_archived', v_archived_accounts, 'pairs', v_pairs))
  where id = p_batch_id and user_id = v_uid;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted,
    'anchored', v_anchored, 'accounts_created', v_created_accounts,
    'accounts_archived', v_archived_accounts, 'pairs', v_pairs);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. delete_connected_item_data — "Disconnect and delete this institution's
--     data": accounts, their transactions, anchors, and batches. The caller
--     has already called /item/remove (or the Item is already disconnected).
-- ---------------------------------------------------------------------------
create or replace function public.delete_connected_item_data(p_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_ids uuid[];
  v_txns int := 0;
  v_anchors int := 0;
  v_batches int := 0;
  v_accounts int := 0;
begin
  if v_uid is null then
    raise exception 'delete_connected_item_data: not authenticated';
  end if;
  if not exists (select 1 from plaid_items i where i.id = p_item_id and i.user_id = v_uid) then
    raise exception 'delete_connected_item_data: ownership (item)';
  end if;

  select coalesce(array_agg(id), '{}') into v_account_ids
  from financial_accounts where plaid_item_id = p_item_id and user_id = v_uid;

  -- Provider-write mode (Item-scoped) so counterpart unpairing passes the
  -- immutability trigger. Set only after the ownership assertion above.
  perform set_config('pfi.provider_write', p_item_id::text, true);

  -- Transfer counterparts on other accounts lose their pairing, not their row.
  update transactions set is_transfer = false, transfer_pair_id = null
    where user_id = v_uid and transfer_pair_id in (
      select id from transactions where account_id = any(v_account_ids) and user_id = v_uid);

  delete from balance_anchors where account_id = any(v_account_ids) and user_id = v_uid;
  get diagnostics v_anchors = row_count;
  delete from transactions where account_id = any(v_account_ids) and user_id = v_uid;
  get diagnostics v_txns = row_count;
  delete from import_batches where plaid_item_id = p_item_id and user_id = v_uid;
  get diagnostics v_batches = row_count;
  delete from financial_accounts where id = any(v_account_ids) and user_id = v_uid;
  get diagnostics v_accounts = row_count;

  update plaid_items set status = 'disconnected', error_code = null
    where id = p_item_id and user_id = v_uid;

  return jsonb_build_object(
    'accounts', v_accounts, 'transactions', v_txns, 'anchors', v_anchors, 'batches', v_batches);
end;
$$;

-- Supabase grants execute on new public functions to anon/authenticated by
-- default; tighten to authenticated + service_role only.
revoke execute on function public.commit_connected_sync(uuid, jsonb) from public, anon;
grant execute on function public.commit_connected_sync(uuid, jsonb) to authenticated, service_role;
revoke execute on function public.delete_connected_item_data(uuid) from public, anon;
grant execute on function public.delete_connected_item_data(uuid) to authenticated, service_role;
