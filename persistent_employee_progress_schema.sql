-- ============================================================
-- persistent_employee_progress_schema.sql
-- Persistent, cross-device employee learning progress.
-- RUN THIS ONCE in the Supabase SQL Editor. Safe & idempotent:
-- every statement is "add column / index if not exists" — nothing is dropped,
-- no rows are deleted, existing submissions/responses are preserved.
--
-- Uses the EXISTING tables (no table is recreated):
--   • learning_progress        — per employee+lesson: status + completed step set
--   • employee_profiles        — current position (already has current_* columns)
--   • knowledge_check_responses — KC answers (PK kcr_<employee>__<kc>, already unique)
--   • submissions               — assignment submissions
--
-- Only learning_progress is extended: it gains the completed-step set + resume
-- pointer so the Learning Path can restore exactly which sections/Knowledge-Check
-- steps a returning employee finished, on any device.
-- ============================================================

-- ---------- learning_progress: completed step set + resume pointer ----------
alter table public.learning_progress add column if not exists completed_steps    text;   -- JSON array of finished step ids
alter table public.learning_progress add column if not exists current_section_id text;   -- resume-within-lesson pointer

-- Deterministic uniqueness already holds via primary keys (idempotent upserts):
--   learning_progress.id        = lp_<employee>__<lesson>   (one row per employee+lesson)
--   knowledge_check_responses.id = kcr_<employee>__<kc>     (one row per employee+KC)
--   employee_profiles.id        = <employee_id>            (one row per employee)
-- so a page refresh / repeated click upserts the SAME row — no duplicates.

-- Helpful lookup index for hydrating one employee's progress (safe, non-unique).
create index if not exists lp_emp_idx    on public.learning_progress (employee_id);
create index if not exists lp_status_idx on public.learning_progress (status);

-- Keep anon read/write working (idempotent; unchanged policy).
alter table public.learning_progress enable row level security;
drop policy if exists lp_all on public.learning_progress;
create policy lp_all on public.learning_progress for all using (true) with check (true);
grant select, insert, update, delete on public.learning_progress to anon, authenticated;
