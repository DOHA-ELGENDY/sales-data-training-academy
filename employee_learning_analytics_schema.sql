-- ============================================================
-- Employee Learning Analytics — admin visibility into progress + responses.
-- RUN THIS ONCE in the Supabase SQL Editor.
--
-- Creates / extends the tables the admin Employee Progress page reads:
--   • employee_profiles      — one row per identified employee
--   • learning_progress      — per lesson status (started / completed)
--   • lesson_activity_log    — lightweight event stream
--   • knowledge_check_responses — created here (with review + scoring fields)
--   • submissions            — score / feedback / reviewed_at (safe add)
--
-- Safe & non-destructive: every statement is IF NOT EXISTS / idempotent, and
-- nothing is dropped. Re-runnable. No auth is enabled (temporary admin rule
-- lives in the app), matching the existing tables' open RLS.
-- ============================================================

-- ---------- helper: open RLS + grants (no real auth yet) ----------
-- Applied per-table below.

-- ============================================================
-- 1) employee_profiles
-- ============================================================
create table if not exists public.employee_profiles (
  id                     text primary key,           -- = employee_id
  employee_name          text,
  team                   text,
  academy_key            text,
  role                   text,
  first_seen             timestamptz default now(),
  last_active            timestamptz default now(),
  current_module_id      text,
  current_module_title   text,
  current_lesson_id      text,
  current_lesson_title   text,
  updated_at             timestamptz default now()
);
alter table public.employee_profiles enable row level security;
drop policy if exists ep_all on public.employee_profiles;
create policy ep_all on public.employee_profiles for all using (true) with check (true);
grant select, insert, update, delete on public.employee_profiles to anon, authenticated;
create index if not exists ep_team_idx on public.employee_profiles (team);
create index if not exists ep_active_idx on public.employee_profiles (last_active desc);

-- ============================================================
-- 2) learning_progress  (one row per employee + lesson)
-- ============================================================
create table if not exists public.learning_progress (
  id             text primary key,       -- = lp_<employee>__<lesson>
  employee_id    text,
  employee_name  text,
  team           text,
  academy_key    text,
  module_id      text,
  lesson_id      text,
  status         text default 'in-progress',  -- not-started | in-progress | completed
  started_at     timestamptz default now(),
  completed_at   timestamptz,
  last_activity  timestamptz default now(),
  updated_at     timestamptz default now()
);
alter table public.learning_progress enable row level security;
drop policy if exists lp_all on public.learning_progress;
create policy lp_all on public.learning_progress for all using (true) with check (true);
grant select, insert, update, delete on public.learning_progress to anon, authenticated;
create index if not exists lp_emp_idx on public.learning_progress (employee_id);
create index if not exists lp_lesson_idx on public.learning_progress (lesson_id);

-- ============================================================
-- 3) lesson_activity_log  (lightweight event stream)
-- ============================================================
create table if not exists public.lesson_activity_log (
  id             text primary key,
  employee_id    text,
  employee_name  text,
  team           text,
  academy_key    text,
  event_type     text,   -- identified | academy_opened | module_opened | lesson_opened
                         -- | kc_submitted | assignment_submitted | lesson_completed
  module_id      text,
  lesson_id      text,
  detail         text,
  created_at     timestamptz default now()
);
alter table public.lesson_activity_log enable row level security;
drop policy if exists lal_all on public.lesson_activity_log;
create policy lal_all on public.lesson_activity_log for all using (true) with check (true);
grant select, insert, update, delete on public.lesson_activity_log to anon, authenticated;
create index if not exists lal_emp_idx on public.lesson_activity_log (employee_id);
create index if not exists lal_created_idx on public.lesson_activity_log (created_at desc);

-- ============================================================
-- 4) knowledge_check_responses  (created here if it doesn't exist yet)
--    Adds review + scoring fields for the admin review workflow.
-- ============================================================
create table if not exists public.knowledge_check_responses (
  id                 text primary key,
  employee_id        text,
  employee_name      text,
  team               text,
  academy_key        text,
  module_id          text,
  lesson_id          text,
  knowledge_check_id text,
  question           text,
  response_type      text,   -- mcq | truefalse | short | doclink | fileupload | text_or_doc | text_or_file
  text_answer        text,
  document_url       text,
  file_url           text,
  file_name          text,
  is_correct         boolean,       -- objective types only
  correct_answer     text,          -- objective types only
  review_status      text default 'Pending Review',  -- Pending Review | Reviewed | Needs Revision | Auto Graded
  score              text,
  feedback           text,
  reviewed_at        timestamptz,
  submitted_at       timestamptz default now()
);
-- If the table already existed (older sprint), make sure the new columns exist.
alter table public.knowledge_check_responses add column if not exists is_correct   boolean;
alter table public.knowledge_check_responses add column if not exists correct_answer text;
alter table public.knowledge_check_responses add column if not exists score        text;
alter table public.knowledge_check_responses add column if not exists feedback     text;
alter table public.knowledge_check_responses add column if not exists reviewed_at  timestamptz;

alter table public.knowledge_check_responses enable row level security;
drop policy if exists kcr_all on public.knowledge_check_responses;
create policy kcr_all on public.knowledge_check_responses for all using (true) with check (true);
grant select, insert, update, delete on public.knowledge_check_responses to anon, authenticated;
create index if not exists kcr_emp_idx on public.knowledge_check_responses (employee_id);
create index if not exists kcr_lesson_idx on public.knowledge_check_responses (lesson_id);
create index if not exists kcr_status_idx on public.knowledge_check_responses (review_status);

-- File-upload bucket for Knowledge Check file responses (public, 10 MB).
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-check-submissions', 'knowledge-check-submissions', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;
drop policy if exists kc_files_insert on storage.objects;
drop policy if exists kc_files_read   on storage.objects;
create policy kc_files_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'knowledge-check-submissions');
create policy kc_files_read on storage.objects
  for select using (bucket_id = 'knowledge-check-submissions');

-- ============================================================
-- 5) submissions — ensure review columns exist (safe if already present)
-- ============================================================
alter table public.submissions add column if not exists score       text;
alter table public.submissions add column if not exists feedback    text;
alter table public.submissions add column if not exists reviewed_at timestamptz;
