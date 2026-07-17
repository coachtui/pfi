-- data_coverage_confidence was write-only: stamped 'demo' unconditionally by
-- snapshotToRow, never read. Score confidence is computed at read time from
-- account providers (DECISIONS #14, metric-inputs.ts). DECISIONS #16.
alter table public.daily_snapshots drop column data_coverage_confidence;
