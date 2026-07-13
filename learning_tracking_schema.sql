-- ============================================================
-- Learning Tracking Engine — real analytics storage.
-- RUN THIS ONCE in the Supabase SQL Editor. Safe & re-runnable
-- (every statement is IF NOT EXISTS / idempotent, nothing is dropped).
-- Self-contained: supersedes employee_learning_analytics_schema.sql —
-- running this alone is enough.
--
-- Tables the Employee Progress Dashboard + tracking layer use:
--   • lesson_activity_log  — the event stream (one row per tracked event)
--   • employee_profiles    — one row per employee (+ resume state + time)
--   • learning_progress    — per-lesson status (started / completed)
-- ============================================================

-- ============================================================
-- 1) lesson_activity_log  — the unified event stream
--    Every event carries: employee, team, academy, module, lesson, section,
--    event_type, score, status, time_spent, created_at.
-- ============================================================
create table if not exists public.lesson_activity_log (
  id             text primary key,
  employee_id    text,
  employee_name  text,
  team           text,
  academy_key    text,
  module_id      text,
  lesson_id      text,
  section_id     text,
  event_type     text,   -- academy_entered | module_opened | lesson_opened
                         -- | section_opened | section_completed
                         -- | kc_started | kc_submitted | kc_result
                         -- | assignment_started | assignment_submitted
                         -- | lesson_completed | module_completed | academy_completed
                         -- | time  (a time-spent heartbeat)
  score          text,
  status         text,
  time_spent     integer default 0,   -- active seconds attributed to this event
  detail         text,
  created_at     timestamptz default now()
);
-- new columns for older deployments of this table
alter table public.lesson_activity_log add column if not exists section_id  text;
alter table public.lesson_activity_log add column if not exists score       text;
alter table public.lesson_activity_log add column if not exists status      text;
alter table public.lesson_activity_log add column if not exists time_spent  integer default 0;
alter table public.lesson_activity_log add column if not exists academy_key text;
alter table public.lesson_activity_log add column if not exists employee_name text;
alter table public.lesson_activity_log add column if not exists team        text;

alter table public.lesson_activity_log enable row level security;
drop policy if exists lal_all on public.lesson_activity_log;
create policy lal_all on public.lesson_activity_log for all using (true) with check (true);
grant select, insert, update, delete on public.lesson_activity_log to anon, authenticated;
create index if not exists lal_emp_idx     on public.lesson_activity_log (employee_id);
create index if not exists lal_created_idx on public.lesson_activity_log (created_at desc);
create index if not exists lal_type_idx    on public.lesson_activity_log (event_type);
create index if not exists lal_lesson_idx  on public.lesson_activity_log (lesson_id);
create index if not exists lal_section_idx on public.lesson_activity_log (section_id);

-- ============================================================
-- 2) employee_profiles  — one row per employee (+ resume state + time)
-- ============================================================
create table if not exists public.employee_profiles (
  id                     text primary key,   -- = employee_id
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
  current_section_id     text,
  current_section_title  text,
  total_time_seconds     integer default 0,
  updated_at             timestamptz default now()
);
-- resume + time columns for older deployments
alter table public.employee_profiles add column if not exists current_section_id    text;
alter table public.employee_profiles add column if not exists current_section_title text;
alter table public.employee_profiles add column if not exists total_time_seconds    integer default 0;

alter table public.employee_profiles enable row level security;
drop policy if exists ep_all on public.employee_profiles;
create policy ep_all on public.employee_profiles for all using (true) with check (true);
grant select, insert, update, delete on public.employee_profiles to anon, authenticated;
create index if not exists ep_team_idx   on public.employee_profiles (team);
create index if not exists ep_active_idx on public.employee_profiles (last_active desc);

-- Atomically add active seconds to an employee's running total (called from the
-- tracking layer so total_time_seconds accumulates instead of being overwritten).
create or replace function public.add_employee_time(p_id text, p_seconds integer)
returns void language sql as $$
  update public.employee_profiles
     set total_time_seconds = coalesce(total_time_seconds, 0) + coalesce(p_seconds, 0),
         updated_at = now()
   where id = p_id;
$$;
grant execute on function public.add_employee_time(text, integer) to anon, authenticated;

-- ============================================================
-- 3) learning_progress  — one row per employee + lesson
-- ============================================================
create table if not exists public.learning_progress (
  id             text primary key,   -- = lp_<employee>__<lesson>
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
create index if not exists lp_emp_idx    on public.learning_progress (employee_id);
create index if not exists lp_lesson_idx on public.learning_progress (lesson_id);
