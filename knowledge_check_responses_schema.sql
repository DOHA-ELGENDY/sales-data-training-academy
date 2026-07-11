-- ============================================================
-- Inline Knowledge Check responses + file-upload bucket.
-- RUN THIS ENTIRE SCRIPT ONCE in the Supabase SQL Editor.
-- Safe to re-run.
-- ============================================================

-- ---------- Responses table ----------
create table if not exists public.knowledge_check_responses (
  id                 text primary key,
  employee_id        text,
  employee_name      text,
  team               text,
  academy_key        text,
  module_id          text,
  lesson_id          text,
  knowledge_check_id text,
  question           text,          -- the question/task (for admin review display)
  response_type      text,          -- short | doclink | fileupload | text_or_doc | text_or_file
  text_answer        text,
  document_url       text,
  file_url           text,
  file_name          text,
  submitted_at       timestamptz default now(),
  review_status      text default 'Pending Review'
);

create index if not exists kcr_team_idx    on public.knowledge_check_responses (team);
create index if not exists kcr_lesson_idx  on public.knowledge_check_responses (lesson_id);
create index if not exists kcr_status_idx   on public.knowledge_check_responses (review_status);
create index if not exists kcr_submitted_idx on public.knowledge_check_responses (submitted_at desc);

-- No auth yet: employees insert, managers read + review (same exposure as content).
alter table public.knowledge_check_responses enable row level security;
drop policy if exists kcr_all on public.knowledge_check_responses;
create policy kcr_all on public.knowledge_check_responses for all using (true) with check (true);
grant select, insert, update, delete on public.knowledge_check_responses to anon, authenticated;

-- ---------- File-upload bucket (public, 10 MB limit) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-check-submissions', 'knowledge-check-submissions', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

drop policy if exists kc_files_insert on storage.objects;
drop policy if exists kc_files_read   on storage.objects;
create policy kc_files_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'knowledge-check-submissions');
create policy kc_files_read on storage.objects
  for select using (bucket_id = 'knowledge-check-submissions');
