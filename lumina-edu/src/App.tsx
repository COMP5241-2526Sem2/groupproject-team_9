/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import TeacherDashboard from './components/TeacherDashboard';
import StudentTutor from './components/StudentTutor';
import { BookOpen, GraduationCap, Sparkles, LogOut, ArrowLeft, Presentation } from 'lucide-react';
import Auth from './components/Auth';
import ResetPassword from './components/ResetPassword';
import CourseList, { type Course } from './components/CourseList';
import { supabase } from './lib/supabase';
import CourseTopBar from './components/CourseTopBar';
import VisionApp from './components/lumina-vision/VisionApp';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
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
  const [isVisionOpen, setIsVisionOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('theme') === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
      );
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
    let isMounted = true;

    const safeStopInitializing = () => {
      if (isMounted) setIsInitializing(false);
    };

    const clearClientSessionAndState = async () => {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.error('Sign out during recovery failed:', signOutError);
      } finally {
        if (!isMounted) return;
        setUser(null);
        setActiveCourse(null);
        setCourses([]);
        setIsResettingPassword(false);
      }
    };

    const initializeAuth = async () => {
      console.log('Initializing auth...');

      const timeoutId = window.setTimeout(() => {
        console.warn('Auth initialization timed out after 10s');
        safeStopInitializing();
      }, 10000);

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.warn('Auth session error:', sessionError.message);

          const lowered = sessionError.message.toLowerCase();
          if (lowered.includes('refresh token') || lowered.includes('invalid') || lowered.includes('expired')) {
            await clearClientSessionAndState();
          }

          return;
        }

        if (!session?.user) {
          console.log('No active session found.');
          return;
        }

        console.log('Session found for user:', session.user.id);

        const { data, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (userError) {
          console.error('Error fetching user profile:', userError);

          await clearClientSessionAndState();
          return;
        }

        if (data && isMounted) {
          setUser({ id: data.id, role: data.role, name: data.name });
        }
      } catch (err) {
        console.error('Unexpected auth initialization error:', err);
      } finally {
        clearTimeout(timeoutId);
        safeStopInitializing();
        console.log('Auth initialization complete.');
      }
    };

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      void (async () => {
        try {
          if (!isMounted) return;

          if (event === 'PASSWORD_RECOVERY') {
            setIsResettingPassword(true);
            return;
          }

          if (event === 'SIGNED_OUT') {
            setUser(null);
            setActiveCourse(null);
            setCourses([]);
            setIsResettingPassword(false);
            setIsInitializing(false);
            return;
          }

          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            if (!session?.user) {
              return;
            }

            const { data, error } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();

            if (error) {
              console.error('Error fetching user after auth state change:', error);
              await clearClientSessionAndState();
              return;
            }

            if (data && isMounted) {
              setUser({ id: data.id, role: data.role, name: data.name });
              setIsResettingPassword(false);
            }
          }
        } catch (err) {
          console.error('Auth state change handler error:', err);
        } finally {
          if (isMounted) {
            setIsInitializing(false);
          }
        }
      })();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void fetchCourses();
    } else {
      setCourses([]);
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

        if (error) {
          console.error('Error fetching teacher courses:', error);
          return;
        }

        if (data) {
          setCourses(
            data.map((d) => ({
              id: d.id,
              name: d.name,
              code: d.code,
              description: d.description,
              teacherName: d.teacher_name,
            }))
          );
        }
      } else {
        const { data, error } = await supabase
          .from('enrollments')
          .select('course_id, courses(*)')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching enrolled courses:', error);
          return;
        }

        if (data) {
          const enrolledCourses = data.map((d: any) => ({
            id: d.courses.id,
            name: d.courses.name,
            code: d.courses.code,
            description: d.courses.description,
            teacherName: d.courses.teacher_name,
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
    setIsResettingPassword(false);
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setActiveCourse(null);
      setCourses([]);
      setIsResettingPassword(false);
    }
  };

  const handleCreateCourse = async (name: string, description: string) => {
    if (!user) return;

    const code = Math.random().toString(36).slice(2, 8).toUpperCase();

    try {
      const { data, error } = await supabase
        .from('courses')
        .insert([
          {
            name,
            description,
            code,
            teacher_id: user.id,
            teacher_name: user.name,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(error);
        alert('Failed to create course. Please check your database schema.');
        return;
      }

      if (data) {
        setCourses((prev) => [
          {
            id: data.id,
            name: data.name,
            code: data.code,
            description: data.description,
            teacherName: data.teacher_name,
          },
          ...prev,
        ]);
      }
    } catch (error) {
      console.error('Create course error:', error);
      alert('Failed to create course. Please check your database schema.');
    }
  };

  const handleJoinCourse = async (code: string) => {
    if (!user) return;

    try {
      const { data: course, error: searchError } = await supabase
        .from('courses')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (searchError) {
        console.error(searchError);
        alert('Failed to search for course.');
        return;
      }

      if (!course) {
        alert('Invalid course code.');
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from('enrollments')
        .select('*')
        .eq('course_id', course.id)
        .eq('student_id', user.id)
        .maybeSingle();

      if (existingError) {
        console.error(existingError);
        alert('Failed to check enrollment status.');
        return;
      }

      if (existing) {
        alert('You are already enrolled in this course.');
        return;
      }

      const { error: enrollError } = await supabase
        .from('enrollments')
        .insert([{ course_id: course.id, student_id: user.id }]);

      if (enrollError) {
        console.error(enrollError);
        alert('Failed to join course.');
        return;
      }

      setCourses((prev) => [
        {
          id: course.id,
          name: course.name,
          code: course.code,
          description: course.description,
          teacherName: course.teacher_name,
        },
        ...prev,
      ]);

      alert(`Successfully joined ${course.name}!`);
    } catch (error) {
      console.error('Join course error:', error);
      alert('Failed to join course.');
    }
  };

  const handleUpdateCourse = async (id: string, name: string, description: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('courses')
        .update({ name, description })
        .eq('id', id);

      if (error) {
        console.error(error);
        alert('Failed to update course.');
        return;
      }

      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, name, description } : c)));

      if (activeCourse?.id === id) {
        setActiveCourse({ ...activeCourse, name, description });
      }
    } catch (error) {
      console.error('Update course error:', error);
      alert('Failed to update course.');
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center transition-colors">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
          <button
            onClick={() => {
              localStorage.clear();
              sessionStorage.clear();
              window.location.reload();
            }}
            className="text-sm text-indigo-600 dark:text-indigo-400 underline"
          >
            Stuck? Reset local session
          </button>
        </div>
      </div>
    );
  }

  if (isResettingPassword) {
    return <ResetPassword onComplete={() => setIsResettingPassword(false)} />;
  }

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  if (isVisionOpen) {
    return <VisionApp onClose={() => setIsVisionOpen(false)} />;
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
        onOpenVision={() => setIsVisionOpen(true)}
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