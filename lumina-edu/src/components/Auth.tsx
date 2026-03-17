import React, { useState } from 'react';
import {
  LogIn,
  GraduationCap,
  Presentation,
  Loader2,
  Mail,
  Lock,
  UserPlus,
  ArrowLeft,
} from 'lucide-react';
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
  const [infoMsg, setInfoMsg] = useState('');

  const resetMessages = () => {
    setErrorMsg('');
    setInfoMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setIsLoading(true);

    try {
      if (isSignUp) {
        if (!name.trim()) throw new Error('Name is required for sign up.');

        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
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
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
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
      let message = error?.message || 'Authentication failed.';

      if (message.includes('Invalid login credentials')) {
        message =
          "Invalid email or password. If you don't have an account, please sign up first.";
      }

      if (message.includes('User already registered')) {
        message = 'This email is already registered. Please sign in instead.';
      }

      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    setIsLoading(true);

    try {
      if (!email.trim()) {
        throw new Error('Please enter your email address.');
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setInfoMsg(
        'Password reset email sent. Please check your inbox and spam folder.'
      );
    } catch (error: any) {
      console.error('Reset password error:', error);
      setErrorMsg(error?.message || 'Failed to send reset email.');
    } finally {
      setIsLoading(false);
    }
  };

  const switchToSignIn = () => {
    setIsSignUp(false);
    setIsForgotPassword(false);
    resetMessages();
  };

  const switchToSignUp = () => {
    setIsSignUp(true);
    setIsForgotPassword(false);
    resetMessages();
  };

  const switchToForgotPassword = () => {
    setIsForgotPassword(true);
    setIsSignUp(false);
    resetMessages();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden border border-slate-100"
      >
        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <GraduationCap className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              {isForgotPassword
                ? 'Forgot Password'
                : isSignUp
                ? 'Create an Account'
                : 'Welcome Back'}
            </h1>
            <p className="text-slate-500 mt-2">
              {isForgotPassword
                ? 'Enter your email and we will send you a reset link'
                : isSignUp
                ? 'Join Lumina Edu today'
                : 'Sign in to continue your learning journey'}
            </p>
          </div>

          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm text-center">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl text-sm text-center">
              {infoMsg}
            </div>
          )}

          {isForgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Email Address
                </label>
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
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-70 bg-indigo-600 hover:bg-indigo-700"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Mail className="w-5 h-5" />
                )}
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={switchToSignIn}
                className="w-full flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-5">
                {isSignUp && (
                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <button
                      type="button"
                      onClick={() => setRole('student')}
                      className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                        role === 'student'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <GraduationCap className="w-6 h-6" />
                      <span className="font-medium">Student</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                        role === 'teacher'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <Presentation className="w-6 h-6" />
                      <span className="font-medium">Teacher</span>
                    </button>
                  </div>
                )}

                {isSignUp && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="John Doe"
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Email Address
                  </label>
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
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">
                    Password
                  </label>
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
                      className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>

                {!isSignUp && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={switchToForgotPassword}
                      className="text-sm text-indigo-600 font-medium hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full py-3 px-4 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-70 ${
                    isSignUp
                      ? role === 'teacher'
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-slate-900 hover:bg-slate-800'
                  }`}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : isSignUp ? (
                    <UserPlus className="w-5 h-5" />
                  ) : (
                    <LogIn className="w-5 h-5" />
                  )}
                  {isLoading
                    ? 'Processing...'
                    : isSignUp
                    ? 'Create Account'
                    : 'Sign In'}
                </button>
              </form>

              <div className="mt-6 text-center text-sm text-slate-500">
                {isSignUp ? (
                  <p>
                    Already have an account?{' '}
                    <button
                      onClick={switchToSignIn}
                      className="text-indigo-600 font-medium hover:underline"
                    >
                      Sign in
                    </button>
                  </p>
                ) : (
                  <p>
                    Don&apos;t have an account?{' '}
                    <button
                      onClick={switchToSignUp}
                      className="text-indigo-600 font-medium hover:underline"
                    >
                      Sign up
                    </button>
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}