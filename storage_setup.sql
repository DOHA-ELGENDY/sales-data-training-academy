-- ============================================================
-- Lesson image storage (run once in the Supabase SQL Editor)
-- Creates a PUBLIC bucket "lesson-images" and lets the anon key upload +
-- read images. Lesson content stores the image URLs (never base64).
-- ============================================================

-- Public bucket (readable by anyone via its public URL).
insert into storage.buckets (id, name, public)
values ('lesson-images', 'lesson-images', true)
on conflict (id) do nothing;

-- Allow anonymous upload + read for this bucket only.
drop policy if exists "lesson_images_insert" on storage.objects;
drop policy if exists "lesson_images_read"   on storage.objects;
drop policy if exists "lesson_images_update"  on storage.objects;

create policy "lesson_images_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'lesson-images');

create policy "lesson_images_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'lesson-images') with check (bucket_id = 'lesson-images');

create policy "lesson_images_read" on storage.objects
  for select using (bucket_id = 'lesson-images');
