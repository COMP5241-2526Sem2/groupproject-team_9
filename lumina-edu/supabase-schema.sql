-- Run this entire script in your Supabase SQL Editor (SQL Editor -> New Query -> Run)

-- Drop existing tables to recreate with proper auth links
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS users;

-- 1. Create users table linked to auth.users
CREATE TABLE public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create courses table
CREATE TABLE public.courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT UNIQUE NOT NULL,
  teacher_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  teacher_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create enrollments table
CREATE TABLE public.enrollments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(course_id, student_id)
);

-- 4. Create chapters table for course content
CREATE TABLE public.chapters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  file_uri TEXT,
  mime_type TEXT,
  local_url TEXT,
  original_name TEXT,
  ppt JSONB DEFAULT '[]'::jsonb,
  quiz JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Create announcements table
CREATE TABLE public.announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Create messages table for group chat
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Create quiz_submissions table
CREATE TABLE public.quiz_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chapter_id UUID REFERENCES public.chapters(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  student_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  answers JSONB NOT NULL, -- Array of student's answer indices
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Set up Row Level Security (RLS) - For this prototype, we will allow all access
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write on users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on courses" ON public.courses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on enrollments" ON public.enrollments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on chapters" ON public.chapters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on announcements" ON public.announcements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read/write on quiz_submissions" ON public.quiz_submissions FOR ALL USING (true) WITH CHECK (true);

-- 9. Enable Realtime for relevant tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
