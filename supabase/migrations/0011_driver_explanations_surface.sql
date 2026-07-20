-- 0011_driver_explanations_surface.sql
-- Phase 4 slice 2 (docs/superpowers/specs/2026-07-20-driver-explanations-design.md):
-- ai_narrations gains the per-driver explanations surface. Same table, same
-- (user_id, surface, input_hash) uniqueness and RLS — only the surface
-- check constraint widens.

alter table public.ai_narrations
  drop constraint ai_narrations_surface_check;

alter table public.ai_narrations
  add constraint ai_narrations_surface_check
  check (surface in ('performance_brief', 'driver_explanations'));
