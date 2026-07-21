-- 0012_academy_progress.sql
-- Academy Slice 3 (docs/superpowers/specs/2026-07-21-academy-slice3-home-lesson-progress-design.md):
-- per-user lesson progress. Status is always DERIVED, never stored: no row =
-- not started, row = in progress, completed_at set = completed.
-- check_responses is a jsonb array of { checkIndex, choiceIndex } — raw
-- responses only; correctness is derivable from the compile-time registry and
-- is never persisted. concept_id has no FK (concepts live in code); server
-- actions validate ids against the published lesson-bearing registry set.
-- No cross-table FK beyond user_id, so no ownership trigger is needed
-- (contrast balance_anchors, DECISIONS #25).

create table public.academy_progress (
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  concept_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check_responses jsonb not null default '[]',
  primary key (user_id, concept_id)
);

alter table public.academy_progress enable row level security;

create policy "own_select" on public.academy_progress for select using (auth.uid() = user_id);
create policy "own_insert" on public.academy_progress for insert with check (auth.uid() = user_id);
create policy "own_update" on public.academy_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.academy_progress for delete using (auth.uid() = user_id);
