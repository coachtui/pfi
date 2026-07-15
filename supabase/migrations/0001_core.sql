-- PFI core schema. Owner-only RLS on every table; no anon access.
create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  age_cohort text not null,
  income_band text not null,
  household_type text not null,
  col_cohort text not null,
  objective text not null,
  privacy_settings jsonb not null default '{}',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.personal_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.user_profiles (id) on delete cascade,
  name text not null,
  ticker text not null,
  logo_path text,
  public_profile_enabled boolean not null default false,
  data_coverage_state text not null default 'demo',
  created_at timestamptz not null default now()
);

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  provider text not null check (provider in ('demo','manual','csv')),
  institution text,
  type text not null check (type in ('checking','savings','money_market','credit_card','mortgage','auto_loan','student_loan','personal_loan','brokerage','retirement','property','other_asset','other_liability')),
  subtype text,
  display_name text not null,
  mask text,
  currency text not null default 'USD',
  current_balance numeric(14,2),
  available_balance numeric(14,2),
  credit_limit numeric(14,2),
  interest_rate numeric(6,4),
  include_in_calculations boolean not null default true,
  include_in_public_score boolean not null default false,
  connection_status text not null default 'ok',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.financial_accounts (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  posted_date date not null,
  authorized_date date,
  amount numeric(14,2) not null check (amount >= 0),
  direction text not null check (direction in ('inflow','outflow')),
  description text not null,
  category text,
  subcategory text,
  txn_type text,
  recurring_status text,
  essential boolean,
  is_transfer boolean not null default false,
  transfer_pair_id uuid,
  confidence numeric(3,2),
  user_override jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create table public.financial_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  date date not null,
  type text not null check (type in ('paycheck','bonus','mortgage_payment','large_purchase','insurance_payment','investment_contribution','debt_payment','debt_payoff','tax_payment','unexpected_expense')),
  label text not null,
  amount numeric(14,2) not null,
  direction text not null check (direction in ('inflow','outflow')),
  created_at timestamptz not null default now()
);

create table public.daily_snapshots (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  date date not null,
  liquid_assets numeric(14,2) not null,
  revolving_balances numeric(14,2) not null,
  near_term_obligations numeric(14,2) not null,
  essential_obligations numeric(14,2) not null,
  safety_buffer numeric(14,2) not null,
  net_worth numeric(14,2) not null,
  engine_version text not null,
  data_coverage_confidence text not null default 'demo',
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index transactions_user_date_idx on public.transactions (user_id, posted_date);
create index financial_events_user_date_idx on public.financial_events (user_id, date);
create index financial_accounts_user_idx on public.financial_accounts (user_id);

-- RLS: default deny, owner-only.
alter table public.user_profiles enable row level security;
alter table public.personal_companies enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.financial_events enable row level security;
alter table public.daily_snapshots enable row level security;

create policy "own_select" on public.user_profiles for select using (auth.uid() = id);
create policy "own_insert" on public.user_profiles for insert with check (auth.uid() = id);
create policy "own_update" on public.user_profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own_delete" on public.user_profiles for delete using (auth.uid() = id);

create policy "own_select" on public.personal_companies for select using (auth.uid() = user_id);
create policy "own_insert" on public.personal_companies for insert with check (auth.uid() = user_id);
create policy "own_update" on public.personal_companies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.personal_companies for delete using (auth.uid() = user_id);

create policy "own_select" on public.financial_accounts for select using (auth.uid() = user_id);
create policy "own_insert" on public.financial_accounts for insert with check (auth.uid() = user_id);
create policy "own_update" on public.financial_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.financial_accounts for delete using (auth.uid() = user_id);

create policy "own_select" on public.transactions for select using (auth.uid() = user_id);
create policy "own_insert" on public.transactions for insert with check (auth.uid() = user_id);
create policy "own_update" on public.transactions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.transactions for delete using (auth.uid() = user_id);

create policy "own_select" on public.financial_events for select using (auth.uid() = user_id);
create policy "own_insert" on public.financial_events for insert with check (auth.uid() = user_id);
create policy "own_update" on public.financial_events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.financial_events for delete using (auth.uid() = user_id);

create policy "own_select" on public.daily_snapshots for select using (auth.uid() = user_id);
create policy "own_insert" on public.daily_snapshots for insert with check (auth.uid() = user_id);
create policy "own_update" on public.daily_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.daily_snapshots for delete using (auth.uid() = user_id);
