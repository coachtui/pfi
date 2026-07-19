-- Password auth: consent proof records + case-insensitive username uniqueness.

-- `Tui` and `tui` must not coexist; username login resolves case-insensitively.
create unique index user_profiles_username_lower_key
  on public.user_profiles (lower(username));

-- Immutable proof of consent. References auth.users (not user_profiles)
-- because consent is recorded at sign-up, before onboarding creates a profile.
create table public.user_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

alter table public.user_agreements enable row level security;

create policy "own agreements select" on public.user_agreements
  for select using ((select auth.uid()) = user_id);

create policy "own agreements insert" on public.user_agreements
  for insert with check ((select auth.uid()) = user_id);

-- Deliberately no update/delete policies: agreements are append-only proof.
