-- ============================================================
-- Assignment submission update — RUN THIS ONCE in the Supabase SQL Editor.
-- Safe & re-runnable: every statement is "add column if not exists" (idempotent,
-- nothing is dropped, no data is lost).
--
-- Adds the columns the finalized Lesson Assignment submission experience needs:
--   • File Upload metadata:  file_url / file_name / file_type / file_size
--   • Review fields:         reviewed_by  (score / feedback / reviewed_at already
--                            exist in submissions_schema.sql — re-added safely here)
--
-- Storage: File uploads reuse the EXISTING public "lesson-images" bucket
-- (storage_setup.sql already grants anon insert/read), so no storage changes are
-- required. The 10 MB limit is enforced client-side before upload.
--
-- Until this runs, File Upload metadata and "Reviewed By" are NOT persisted;
-- Text Answer and Document Link submissions keep working (the app drops unknown
-- columns and still saves the row).
-- ============================================================

-- File Upload metadata
alter table public.submissions add column if not exists file_url   text;
alter table public.submissions add column if not exists file_name  text;
alter table public.submissions add column if not exists file_type  text;
alter table public.submissions add column if not exists file_size  bigint;

-- Review fields
alter table public.submissions add column if not exists reviewed_by  text;
alter table public.submissions add column if not exists score        text;
alter table public.submissions add column if not exists feedback     text;
alter table public.submissions add column if not exists reviewed_at  timestamptz;
alter table public.submissions add column if not exists status       text default 'Pending Review';

-- Keep anon insert/update/select working (idempotent; matches the base schema).
alter table public.submissions enable row level security;
drop policy if exists submissions_all on public.submissions;
create policy submissions_all on public.submissions for all using (true) with check (true);
grant select, insert, update, delete on public.submissions to anon, authenticated;
