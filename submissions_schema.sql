-- ============================================================
-- FIX submissions table — RUN THIS ENTIRE SCRIPT in the Supabase SQL Editor.
-- ------------------------------------------------------------
-- The original submissions table has an IDENTITY (bigint) id and is missing
-- most columns, so the app (which sends a text id + employee/lesson/team
-- columns) cannot insert. This drops and recreates it with the correct schema.
-- The table is empty, so nothing is lost. Kept minimal (no triggers/checks) so
-- it can't fail mid-script.
--
-- After running, you should see "Success. No rows returned".
-- Verify with:
--   select column_name from information_schema.columns
--     where table_name = 'submissions' order by ordinal_position;
-- (you should see employee_id, employee_name, team, created_at, …)
-- ============================================================

drop table if exists public.submissions cascade;

create table public.submissions (
  id               text primary key,
  academy_key      text,
  module_id        text,
  module_title     text,
  lesson_id        text,
  lesson_title     text,
  assignment_id    text,
  assignment_title text,
  employee_id      text,          -- from the Identification layer
  employee_name    text,
  team             text,          -- from the Identification layer
  submission_link  text,
  text_answer      text,
  notes            text,
  status           text default 'Pending Review',
  score            text,
  feedback         text,
  reviewed_at      timestamptz,
  created_at       timestamptz default now(),   -- "Submitted At"
  updated_at       timestamptz default now()
);

alter table public.submissions enable row level security;
drop policy if exists submissions_all on public.submissions;
drop policy if exists submissions_anon_all on public.submissions;
create policy submissions_all on public.submissions for all using (true) with check (true);
grant select, insert, update, delete on public.submissions to anon, authenticated;
