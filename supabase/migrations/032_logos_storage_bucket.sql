-- The Settings > Brand "Company logo" upload has been silently failing:
-- the app code uploads to a Storage bucket called "logos", but nothing in
-- this project ever created that bucket, so every upload errors out and
-- the UI (which only updated the preview on success) just showed nothing.
-- This creates the bucket and the policies needed for it to actually work:
-- public read (so the logo can render in previews/decks/the public review
-- page) and authenticated write (so logged-in users can upload/replace it).

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read access to logos" on storage.objects;
create policy "Public read access to logos"
  on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists "Authenticated users can upload logos" on storage.objects;
create policy "Authenticated users can upload logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos');

drop policy if exists "Authenticated users can update logos" on storage.objects;
create policy "Authenticated users can update logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logos');

drop policy if exists "Authenticated users can delete logos" on storage.objects;
create policy "Authenticated users can delete logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logos');
