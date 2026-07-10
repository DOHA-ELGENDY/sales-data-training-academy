-- ============================================================
-- Assignment Submissions — full schema (run once in Supabase SQL Editor)
-- The submissions table was empty, so this drops & recreates it with the
-- employee-submission + manager-review columns. Safe to re-run.
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop table if exists public.submissions cascade;

create table public.submissions (
  id               text primary key,           -- client-generated (offline-safe upsert)
  created_at       timestamptz not null default now(),   -- "Submitted At"
  academy_key      text,
  module_id        text,
  module_title     text,
  lesson_id        text,
  lesson_title     text,
  assignment_id    text,
  assignment_title text,
  employee_id      text,                 -- from the Identification layer
  employee_name    text,
  team             text,                 -- from the Identification layer
  submission_link  text,
  text_answer      text,
  notes            text,
  status           text not null default 'Pending Review'
                   check (status in ('Pending Review', 'Reviewed', 'Needs Revision')),
  score            text,
  feedback         text,
  reviewed_at      timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists submissions_academy_idx on public.submissions (academy_key);
create index if not exists submissions_lesson_idx  on public.submissions (lesson_id);
create index if not exists submissions_team_idx    on public.submissions (team);
create index if not exists submissions_status_idx  on public.submissions (status);
create index if not exists submissions_created_idx on public.submissions (created_at desc);

drop trigger if exists set_updated_at on public.submissions;
create trigger set_updated_at before update on public.submissions
  for each row execute function public.set_updated_at();

-- RLS: no user auth yet — anon can submit (insert) and managers can read/update.
alter table public.submissions enable row level security;
drop policy if exists submissions_anon_all on public.submissions;
create policy submissions_anon_all on public.submissions
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.submissions to anon, authenticated;
