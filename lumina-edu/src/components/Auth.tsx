import React, { useState } from 'react';
import { LogIn, GraduationCap, Presentation, Loader2, Mail, Lock, UserPlus, Sparkles, ArrowRight, User } from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';

interface AuthProps {
  onLogin: (id: string, role: 'teacher' | 'student', name: string) => void;
}

export default function Auth({ onLogin }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      if (isForgotPassword) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setSuccessMsg('Password reset link has been sent to your email.');
      } else if (isSignUp) {
        if (!name.trim()) throw new Error('Name is required for sign up.');
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Signup failed. Please try again.');

        const { error: profileError } = await supabase
          .from('users')
          .insert([{ id: authData.user.id, name: name.trim(), role }]);

        if (profileError) throw profileError;

        onLogin(authData.user.id, role, name.trim());
      } else {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Login failed.');

        const { data: profileData, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('id', authData.user.id)
          .single();

        if (profileError) throw profileError;

        onLogin(authData.user.id, profileData.role, profileData.name);
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      let message = error.message || 'Authentication failed.';
      if (message.includes('Invalid login credentials')) {
        message = 'Invalid email or password. If you don\'t have an account, please sign up first.';
      }
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row transition-colors relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-500/10 blur-[120px] dark:bg-indigo-500/20 animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-emerald-500/10 blur-[120px] dark:bg-emerald-500/20 animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-purple-500/10 blur-[80px] dark:bg-purple-500/15" />
      </div>

      {/* Left Side: Brand & Visuals (Desktop only) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-4"
        >
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-xl shadow-indigo-500/30">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <span className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">
            Lumina <span className="text-indigo-600">Edu</span>
          </span>
        </motion.div>

        <div className="max-w-xl">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-5xl lg:text-7xl font-black text-slate-900 dark:text-white leading-[1.1] tracking-tighter mb-6"
          >
            ℒ𝓊𝓂𝒾𝓃𝒶 𝒮𝓅𝒶𝓇𝓀ℯ𝓈 <br />
            <span className="text-indigo-600">ℰ𝒹𝓊𝒸𝒶𝓉𝒾ℴ𝓃</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-xl text-slate-500 dark:text-slate-400 mb-12 leading-relaxed"
          >
            Experience a new era of education with our AI-powered platform designed for modern students and teachers.
          </motion.p>

          <div className="grid grid-cols-2 gap-6">
            {[
              { icon: GraduationCap, title: "Smart Learning", desc: "Adaptive paths for every student" },
              { icon: Presentation, title: "Expert Tools", desc: "Powerful resources for educators" },
              { icon: Sparkles, title: "AI Insights", desc: "Real-time progress analytics" },
              { icon: ArrowRight, title: "Global Access", desc: "Learn anywhere, anytime" },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1 }}
                className="p-6 rounded-3xl bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm border border-white/20 dark:border-slate-800/50"
              >
                <feature.icon className="w-6 h-6 text-indigo-600 mb-3" />
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">{feature.title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-sm text-slate-400 dark:text-slate-600 font-medium"
        >
          &copy; 2026 Lumina Edu. All rights reserved.
        </motion.div>
      </div>

      {/* Right Side: Auth Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 lg:p-12 relative z-10">
        {/* Mobile Logo (Visible only on small screens) */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:hidden mb-8 text-center"
        >
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="bg-indigo-600 p-3 rounded-2xl shadow-xl shadow-indigo-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-slate-900 dark:text-white">
              Lumina <span className="text-indigo-600">Edu</span>
            </h1>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="w-full max-w-md relative"
        >
          <div className="absolute inset-0 bg-indigo-600/5 blur-3xl rounded-3xl -z-10" />
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl w-full rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] dark:shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] overflow-hidden border border-white/40 dark:border-slate-800/50">
            <div className="p-8 sm:p-10">
              <div className="mb-8">
                <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                  {isForgotPassword ? 'Reset Password' : isSignUp ? 'Create Account' : 'Welcome Back'}
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">
                  {isForgotPassword 
                    ? 'Enter your email to receive a reset link' 
                    : isSignUp 
                      ? 'Join our community of students and teachers' 
                      : 'Sign in to access your personalized learning dashboard'}
                </p>
              </div>

            {errorMsg && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 text-red-600 dark:text-red-400 rounded-2xl text-sm flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 rounded-2xl text-sm flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                {successMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {isSignUp && !isForgotPassword && (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setRole('student')}
                    className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                      role === 'student' 
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' 
                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 text-slate-500 dark:text-slate-500'
                    }`}
                  >
                    <GraduationCap className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase tracking-wider">Student</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setRole('teacher')}
                    className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${
                      role === 'teacher' 
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' 
                        : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 text-slate-500 dark:text-slate-500'
                    }`}
                  >
                    <Presentation className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase tracking-wider">Teacher</span>
                  </button>
                </div>
              )}

              {isSignUp && !isForgotPassword && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <UserPlus className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all"
                  />
                </div>
              </div>

              {!isForgotPassword && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Password</label>
                    {!isSignUp && (
                      <button 
                        type="button"
                        onClick={() => setIsForgotPassword(true)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Forgot?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-4 px-4 rounded-2xl text-white font-bold shadow-lg transition-all active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2 ${
                  isForgotPassword
                    ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'
                    : isSignUp 
                      ? (role === 'teacher' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20')
                      : 'bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 shadow-indigo-500/20'
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isForgotPassword ? (
                  <Mail className="w-5 h-5" />
                ) : isSignUp ? (
                  <UserPlus className="w-5 h-5" />
                ) : (
                  <LogIn className="w-5 h-5" />
                )}
                {isLoading ? 'Processing...' : isForgotPassword ? 'Send Reset Link' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>
            </form>
            
            <div className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {isForgotPassword ? (
                <button onClick={() => setIsForgotPassword(false)} className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                  Back to Sign In
                </button>
              ) : isSignUp ? (
                <p>
                  Already have an account?{' '}
                  <button onClick={() => setIsSignUp(false)} className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                    Sign in
                  </button>
                </p>
              ) : (
                <p>
                  Don't have an account?{' '}
                  <button onClick={() => setIsSignUp(true)} className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                    Sign up
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
      </div>
    </div>
  );
}
