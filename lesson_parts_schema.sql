-- ============================================================
-- Lesson Parts — add a structured `parts` array to lessons.
-- RUN THIS ENTIRE SCRIPT ONCE in the Supabase SQL Editor.
-- Safe to re-run. NO CONTENT LOSS: content_body and blocks are preserved;
-- parts is additive and defaults to an empty array.
-- ============================================================

-- A Lesson is now: ordered Parts, each Part = { id, partNumber, title, order,
-- status, blocks[], knowledgeCheck, createdAt, updatedAt }. Stored as JSONB.
alter table public.lessons
  add column if not exists parts jsonb not null default '[]'::jsonb;

-- Backward compatibility is kept in code:
--   * lesson.parts is authoritative when non-empty.
--   * legacy lessons (only blocks / content_body) are converted to Parts on the
--     fly (split at each Knowledge Check) — nothing to migrate by hand.
--   * content_body and blocks columns are untouched and keep rendering legacy
--     lessons until every lesson has been re-saved with parts.

-- (No data backfill is required. Existing rows get parts = [] and are converted
--  to Parts on read by the app. Re-saving a lesson in the Content Manager writes
--  its authored parts here.)
