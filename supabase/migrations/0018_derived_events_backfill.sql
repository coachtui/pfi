-- Plaid Slice 2 (DECISIONS #44): households that already have non-demo data
-- get no derived driver events until something triggers a rebuild. Flag every
-- profile so the dashboard's repair path (prepareDashboard, under the per-user
-- lease) derives them on the next load. Idempotent and harmless for profiles
-- with nothing to derive.
update public.user_profiles set rebuild_pending_at = now() where rebuild_pending_at is null;
