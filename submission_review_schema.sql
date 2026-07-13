-- ============================================================
-- Submission Review Center — schema update.
-- RUN THIS ONCE in the Supabase SQL Editor. Safe & re-runnable (every statement
-- is "add column if not exists" — nothing is dropped, no data is lost).
-- Self-contained: running THIS file alone is enough for the Review Center
-- (it supersedes assignment_submission_update_schema.sql).
--
-- Adds the file + review columns the Review Center reads/writes on BOTH sources:
--   • knowledge_check_responses  (Knowledge Check submissions)
--   • submissions                (Lesson Assignment submissions)
--
-- Uploaded files reuse the EXISTING public storage buckets
-- ('knowledge-check-submissions' and 'lesson-images'), whose anon read policies
-- are already set — so their public URLs open directly. No storage changes here.
-- ============================================================

-- ---------- knowledge_check_responses ----------
alter table public.knowledge_check_responses add column if not exists section_id     text;
alter table public.knowledge_check_responses add column if not exists file_url       text;
alter table public.knowledge_check_responses add column if not exists file_name      text;
alter table public.knowledge_check_responses add column if not exists file_type      text;
alter table public.knowledge_check_responses add column if not exists file_size      bigint;
alter table public.knowledge_check_responses add column if not exists review_status  text default 'Pending Review';
alter table public.knowledge_check_responses add column if not exists score          text;
alter table public.knowledge_check_responses add column if not exists feedback       text;
alter table public.knowledge_check_responses add column if not exists reviewed_by    text;
alter table public.knowledge_check_responses add column if not exists reviewed_at    timestamptz;

create index if not exists kcr_status_idx    on public.knowledge_check_responses (review_status);
create index if not exists kcr_submitted_idx on public.knowledge_check_responses (submitted_at desc);

alter table public.knowledge_check_responses enable row level security;
drop policy if exists kcr_all on public.knowledge_check_responses;
create policy kcr_all on public.knowledge_check_responses for all using (true) with check (true);
grant select, insert, update, delete on public.knowledge_check_responses to anon, authenticated;

-- ---------- submissions ----------
alter table public.submissions add column if not exists file_url    text;
alter table public.submissions add column if not exists file_name   text;
alter table public.submissions add column if not exists file_type   text;
alter table public.submissions add column if not exists file_size   bigint;
alter table public.submissions add column if not exists reviewed_by text;
alter table public.submissions add column if not exists score       text;
alter table public.submissions add column if not exists feedback    text;
alter table public.submissions add column if not exists reviewed_at timestamptz;
alter table public.submissions add column if not exists status      text default 'Pending Review';

create index if not exists submissions_status_idx    on public.submissions (status);
create index if not exists submissions_created_idx   on public.submissions (created_at desc);

alter table public.submissions enable row level security;
drop policy if exists submissions_all on public.submissions;
create policy submissions_all on public.submissions for all using (true) with check (true);
grant select, insert, update, delete on public.submissions to anon, authenticated;
