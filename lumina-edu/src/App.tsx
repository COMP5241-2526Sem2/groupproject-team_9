/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import TeacherDashboard from './components/TeacherDashboard';
import StudentTutor from './components/StudentTutor';
import { BookOpen, GraduationCap, Sparkles, LogOut, ArrowLeft, Presentation } from 'lucide-react';
import Auth from './components/Auth';
import ResetPassword from './components/ResetPassword';
import CourseList, { Course } from './components/CourseList';
import { supabase } from './lib/supabase';
import CourseTopBar from './components/CourseTopBar';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-xl max-w-md w-full border border-red-100 dark:border-red-900/30">
            <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">Something went wrong</h2>
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              The application encountered an unexpected error. Please try refreshing the page.
            </p>
            <pre className="bg-slate-100 dark:bg-slate-900 p-4 rounded-lg text-xs overflow-auto max-h-40 mb-6 text-slate-700 dark:text-slate-400">
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-colors"
            >
              Refresh Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<{ id: string; role: 'teacher' | 'student'; name: string } | null>(null);
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const initializeAuth = async () => {
      console.log('Initializing auth...');
      const timeoutId = setTimeout(() => {
        if (isInitializing) {
          console.warn('Auth initialization timed out after 10s');
          setIsInitializing(false);
        }
      }, 10000);

      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        clearTimeout(timeoutId);
        
        if (error) {
          console.warn('Auth session error:', error.message);
          if (error.message.includes('Refresh Token')) {
            await supabase.auth.signOut();
          }
          setIsInitializing(false);
          return;
        }

        if (session?.user) {
          console.log('Session found for user:', session.user.id);
          const { data, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();

          if (data && !userError) {
            setUser({ id: data.id, role: data.role, name: data.name });
          } else if (userError) {
            console.error('Error fetching user profile:', userError);
          }
        } else {
          console.log('No active session found.');
        }
      } catch (err) {
        console.error('Unexpected auth initialization error:', err);
      } finally {
        setIsInitializing(false);
        console.log('Auth initialization complete.');
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setActiveCourse(null);
        setCourses([]);
        setIsResettingPassword(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();
          
          if (data) {
            setUser({ id: data.id, role: data.role, name: data.name });
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
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

  const handleUpdateCourse = async (id: string, name: string, description: string) => {
    if (!user) return;
    
    const { error } = await supabase
      .from('courses')
      .update({ name, description })
      .eq('id', id);

    if (!error) {
      setCourses(courses.map(c => c.id === id ? { ...c, name, description } : c));
      if (activeCourse?.id === id) {
        setActiveCourse({ ...activeCourse, name, description });
      }
    } else {
      console.error(error);
      alert('Failed to update course.');
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center transition-colors">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
      </div>
    );
  }

  if (isResettingPassword) {
    return <ResetPassword onComplete={() => setIsResettingPassword(false)} />;
  }

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      <CourseTopBar 
        user={user}
        activeCourse={activeCourse}
        onBack={() => setActiveCourse(null)}
        onLogout={handleLogout}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
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
            onUpdateCourse={handleUpdateCourse}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
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

