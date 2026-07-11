-- ============================================================
-- Lesson Block Builder — add the ordered `blocks` array to lessons.
-- RUN THIS ONCE in the Supabase SQL Editor.
--
-- Safe & non-destructive:
--   • Adds a `blocks` JSONB column, default empty array.
--   • Existing lessons keep their rows and their `content_body` untouched.
--   • Idempotent (IF NOT EXISTS) — safe to re-run.
--
-- Rollback: `ALTER TABLE public.lessons DROP COLUMN blocks;`
--   content_body is still present, so lessons keep rendering after a rollback.
-- ============================================================

alter table public.lessons
  add column if not exists blocks jsonb not null default '[]'::jsonb;

-- Backfill any NULLs (only relevant if the column pre-existed without a default).
update public.lessons set blocks = '[]'::jsonb where blocks is null;
