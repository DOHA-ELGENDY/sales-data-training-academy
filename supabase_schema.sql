-- ============================================================
-- Sales Data Training Academy — Supabase schema (production backend)
-- Run this once in the Supabase SQL Editor (New query ▸ paste ▸ Run).
-- Creates the content tables, indexes, Row Level Security policies, and
-- seeds the three academies. Safe to re-run.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.academies (
  key         text primary key,
  name        text,
  team        text,
  icon        text,
  logo        text,
  description text,
  sort_order  int,
  updated_at  timestamptz default now()
);

create table if not exists public.modules (
  id            text primary key,
  academy_key   text,
  module_number text,
  module_title  text,
  short_desc    text,
  objectives    jsonb default '[]'::jsonb,
  study_time    text,
  difficulty    text,
  prerequisites text,
  status        text default 'Draft',
  updated_at    timestamptz default now()
);

-- Nested assignment/activities are stored as jsonb; content_body is rich HTML.
-- module_id is not a hard FK so lessons can be upserted independently; the app
-- cascades deletes (deleting a module removes its lessons).
create table if not exists public.lessons (
  id            text primary key,
  academy_key   text,
  module_id     text,
  module_number text,
  lesson_number text,
  lesson_title  text,
  content_type  text,
  content_body  text,
  status        text default 'Draft',
  sort_order    int,
  assignment    jsonb,
  activities    jsonb default '[]'::jsonb,
  updated_at    timestamptz default now()
);

create table if not exists public.submissions (
  id              bigint generated always as identity primary key,
  created_at      timestamptz default now(),
  employee_name   text,
  assignment_id   text,
  submission_link text,
  notes           text,
  status          text default 'Pending Review'
);

-- ---------- Indexes ----------
create index if not exists modules_academy_idx on public.modules (academy_key);
create index if not exists lessons_academy_idx on public.lessons (academy_key);
create index if not exists lessons_module_idx  on public.lessons (module_id);

-- ---------- Row Level Security ----------
-- The app has no user auth and uses the public "anon" key, matching the
-- previous "Anyone" access model. Content is world-readable and writable;
-- submissions are insert-only (not publicly readable).
alter table public.academies   enable row level security;
alter table public.modules     enable row level security;
alter table public.lessons     enable row level security;
alter table public.submissions enable row level security;

drop policy if exists academies_all on public.academies;
drop policy if exists modules_all   on public.modules;
drop policy if exists lessons_all   on public.lessons;
drop policy if exists submissions_insert on public.submissions;

create policy academies_all on public.academies for all using (true) with check (true);
create policy modules_all   on public.modules   for all using (true) with check (true);
create policy lessons_all   on public.lessons   for all using (true) with check (true);
create policy submissions_insert on public.submissions for insert with check (true);

-- ---------- Grants (so the anon/authenticated roles can operate) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.academies, public.modules, public.lessons to anon, authenticated;
grant insert on public.submissions to anon, authenticated;

-- ---------- Seed academies ----------
insert into public.academies (key, name, team, icon, logo, description, sort_order) values
  ('sales-data', 'Sales Data', 'Sales Data Team', '📊', 'SD',
     'Training path for Sales Data, Reporting, CRM Operations and Data Analysis.', 1),
  ('sales', 'Sales', 'Sales Team', '🤝', 'S',
     'Sales onboarding and sales skills training.', 2),
  ('sales-accounting', 'Sales Accounting', 'Sales Accounting Team', '🧾', 'SA',
     'Training path for Sales Accounting operations and payment follow-up.', 3)
on conflict (key) do nothing;
