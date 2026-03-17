/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import TeacherDashboard from './components/TeacherDashboard';
import StudentTutor from './components/StudentTutor';
import { BookOpen, GraduationCap, Sparkles, LogOut, ArrowLeft, Presentation } from 'lucide-react';
import Auth from './components/Auth';
import CourseList, { Course } from './components/CourseList';
import { supabase } from './lib/supabase';
import CourseTopBar from './components/CourseTopBar';


export default function App() {
  const [user, setUser] = useState<{ id: string; role: 'teacher' | 'student'; name: string } | null>(null);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single()
          .then(({ data }) => {
            if (data) {
              setUser({ id: data.id, role: data.role, name: data.name });
            }
            setIsInitializing(false);
          });
      } else {
        setIsInitializing(false);
      }
    });
  }, []);

  useEffect(() => {
    if (user) {
      fetchCourses();
    }
  }, [user]);

  const fetchCourses = async () => {
    if (!user) return;
    try {
      if (user.role === 'teacher') {
        const { data, error } = await supabase
          .from('courses')
          .select('*')
          .eq('teacher_id', user.id)
          .order('created_at', { ascending: false });
          
        if (data) {
          setCourses(data.map(d => ({ 
            id: d.id, 
            name: d.name, 
            code: d.code, 
            description: d.description, 
            teacherName: d.teacher_name 
          })));
        }
      } else {
        const { data, error } = await supabase
          .from('enrollments')
          .select('course_id, courses(*)')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false });
          
        if (data) {
          const enrolledCourses = data.map((d: any) => ({
            id: d.courses.id,
            name: d.courses.name,
            code: d.courses.code,
            description: d.courses.description,
            teacherName: d.courses.teacher_name
          }));
          setCourses(enrolledCourses);
        }
      }
    } catch (error) {
      console.error('Error fetching courses:', error);
    }
  };

  const handleLogin = (id: string, role: 'teacher' | 'student', name: string) => {
    setUser({ id, role, name });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setActiveCourse(null);
    setCourses([]);
  };

  const handleCreateCourse = async (name: string, description: string) => {
    if (!user) return;
    const code = Math.random().toString(36).substr(2, 6).toUpperCase();
    
    const { data, error } = await supabase
      .from('courses')
      .insert([{ 
        name, 
        description, 
        code, 
        teacher_id: user.id, 
        teacher_name: user.name 
      }])
      .select()
      .single();

    if (data) {
      setCourses([{ 
        id: data.id, 
        name: data.name, 
        code: data.code, 
        description: data.description, 
        teacherName: data.teacher_name 
      }, ...courses]);
    } else {
      console.error(error);
      alert('Failed to create course. Please check your database schema.');
    }
  };

  const handleJoinCourse = async (code: string) => {
    if (!user) return;
    
    // Find course
    const { data: course, error: searchError } = await supabase
      .from('courses')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (!course) {
      alert('Invalid course code.');
      return;
    }

    // Check if already enrolled
    const { data: existing } = await supabase
      .from('enrollments')
      .select('*')
      .eq('course_id', course.id)
      .eq('student_id', user.id)
      .maybeSingle();

    if (existing) {
      alert('You are already enrolled in this course.');
      return;
    }

    // Enroll
    const { error: enrollError } = await supabase
      .from('enrollments')
      .insert([{ course_id: course.id, student_id: user.id }]);

    if (!enrollError) {
      setCourses([{ 
        id: course.id, 
        name: course.name, 
        code: course.code, 
        description: course.description, 
        teacherName: course.teacher_name 
      }, ...courses]);
      alert(`Successfully joined ${course.name}!`);
    } else {
      console.error(enrollError);
      alert('Failed to join course.');
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <CourseTopBar 
        user={user}
        activeCourse={activeCourse}
        onBack={() => setActiveCourse(null)}
        onLogout={handleLogout}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!activeCourse ? (
          <CourseList 
            role={user.role} 
            userName={user.name}
            courses={courses}
            onSelectCourse={setActiveCourse}
            onCreateCourse={handleCreateCourse}
            onJoinCourse={handleJoinCourse}
          />
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {user.role === 'teacher' ? (
              <TeacherDashboard course={activeCourse} user={user} />
            ) : (
              <StudentTutor course={activeCourse} user={user} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

