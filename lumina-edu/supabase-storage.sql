-- Run this script in your Supabase SQL Editor to set up the storage bucket for course materials

-- 1. Create a new storage bucket for course materials
insert into storage.buckets (id, name, public)
values ('course-materials', 'course-materials', true)
on conflict (id) do nothing;

-- 2. Set up access controls (Row Level Security) for the bucket
-- Allow anyone to read/download the files
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'course-materials' );

-- Allow authenticated users (teachers) to upload files
create policy "Authenticated users can upload files"
  on storage.objects for insert
  with check ( bucket_id = 'course-materials' and auth.role() = 'authenticated' );

-- Allow users to update their own files
create policy "Users can update their own files"
  on storage.objects for update
  using ( bucket_id = 'course-materials' and auth.uid() = owner );

-- Allow users to delete their own files
create policy "Users can delete their own files"
  on storage.objects for delete
  using ( bucket_id = 'course-materials' and auth.uid() = owner );
