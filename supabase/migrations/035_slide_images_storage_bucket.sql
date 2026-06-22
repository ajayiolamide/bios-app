-- The slide editor's new "Add image" control uploads to a Storage bucket
-- called "slide-images" — same pattern as the "logos" bucket (migration 032,
-- which fixed the exact same "bucket never existed" failure mode): public
-- read so the image renders in deck previews, the PPTX export, and the
-- public review page, authenticated write so logged-in users can attach one
-- per slide.

insert into storage.buckets (id, name, public)
values ('slide-images', 'slide-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read access to slide-images" on storage.objects;
create policy "Public read access to slide-images"
  on storage.objects for select
  using (bucket_id = 'slide-images');

drop policy if exists "Authenticated users can upload slide-images" on storage.objects;
create policy "Authenticated users can upload slide-images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'slide-images');

drop policy if exists "Authenticated users can update slide-images" on storage.objects;
create policy "Authenticated users can update slide-images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'slide-images');

drop policy if exists "Authenticated users can delete slide-images" on storage.objects;
create policy "Authenticated users can delete slide-images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'slide-images');
