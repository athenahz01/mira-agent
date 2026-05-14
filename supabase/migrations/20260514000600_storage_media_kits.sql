insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-kits',
  'media-kits',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users can read own media kit files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'media-kits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can upload own media kit files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media-kits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can update own media kit files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media-kits'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'media-kits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can delete own media kit files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media-kits'
  and (storage.foldername(name))[1] = auth.uid()::text
);
