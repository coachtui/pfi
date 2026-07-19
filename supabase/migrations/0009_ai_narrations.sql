-- 0009_ai_narrations.sql
-- AI narration cache + audit log (docs/superpowers/specs/2026-07-18-ai-interpreter-core-design.md).
-- One row per (user, surface, input-hash): input_json is the exact verified
-- metrics the model received (derived values only — the NarrationInput type
-- cannot carry raw transactions/merchants), output_json the validated
-- narration. Failures are never cached. No cross-table FK beyond user_id,
-- so no ownership trigger is needed (contrast balance_anchors, DECISIONS #25).

create table public.ai_narrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  surface text not null check (surface in ('performance_brief')),
  input_hash text not null,
  input_json jsonb not null,
  output_json jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, surface, input_hash)
);

alter table public.ai_narrations enable row level security;

create policy "own_select" on public.ai_narrations for select using (auth.uid() = user_id);
create policy "own_insert" on public.ai_narrations for insert with check (auth.uid() = user_id);
create policy "own_update" on public.ai_narrations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.ai_narrations for delete using (auth.uid() = user_id);
