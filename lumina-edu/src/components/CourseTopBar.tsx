import React, { useState, useEffect, useRef } from 'react';
import { Bell, MessageSquare, ArrowLeft, Sparkles, LogOut, Presentation, GraduationCap, ChevronDown, Search, X, Plus, Moon, Sun } from 'lucide-react';
import { Course } from './CourseList';
import AnnouncementModal from './AnnouncementModal';
import GroupChat from './GroupChat';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'motion/react';

interface CourseTopBarProps {
  user: { id: string; role: 'teacher' | 'student'; name: string };
  activeCourse: Course | null;
  onBack: () => void;
  onLogout: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export default function CourseTopBar({ user, activeCourse, onBack, onLogout, searchQuery, onSearchChange, isDarkMode, onToggleDarkMode }: CourseTopBarProps) {
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchExpanded) {
      searchInputRef.current?.focus();
    }
  }, [isSearchExpanded]);

  useEffect(() => {
    if (activeCourse) {
      checkUnreadAnnouncements();
      
      // Subscribe to new announcements
      const channel = supabase
        .channel(`announcements_${activeCourse.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'announcements',
            filter: `course_id=eq.${activeCourse.id}`,
          },
          () => {
            if (!isAnnouncementOpen) {
              setHasUnreadAnnouncements(true);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [activeCourse, isAnnouncementOpen]);

  const checkUnreadAnnouncements = async () => {
    if (!activeCourse) return;

    const lastReadId = localStorage.getItem(`lastReadAnnouncement_${activeCourse.id}`);
    
    const { data, error } = await supabase
      .from('announcements')
      .select('id')
      .eq('course_id', activeCourse.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const latestId = data[0].id;
      if (latestId !== lastReadId) {
        setHasUnreadAnnouncements(true);
      }
    }
  };

  const handleOpenAnnouncements = () => {
    setIsAnnouncementOpen(true);
    setHasUnreadAnnouncements(false);
    
    // Mark as read
    if (activeCourse) {
      supabase
        .from('announcements')
        .select('id')
        .eq('course_id', activeCourse.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) {
            localStorage.setItem(`lastReadAnnouncement_${activeCourse.id}`, data[0].id);
          }
        });
    }
  };

  return (
    <>
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              {activeCourse && (
                <button 
                  onClick={onBack}
                  className="p-2 -ml-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div className="flex items-center gap-2">
                <div className="bg-indigo-600 p-2 rounded-xl">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-emerald-600">
                  Lumina Edu
                </span>
              </div>
              {activeCourse && (
                <div className="hidden md:flex items-center gap-2 ml-4 pl-4 border-l border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-medium text-slate-600 dark:text-white">{activeCourse.name}</span>
                  <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-500 dark:text-slate-400 font-mono">{activeCourse.code}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Search Module (Only on Course List) */}
              {!activeCourse && (
                <div className="flex items-center">
                  <AnimatePresence mode="wait">
                    {isSearchExpanded ? (
                      <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden"
                      >
                        <div className="pl-3">
                          <Search className="w-4 h-4 text-slate-400" />
                        </div>
                        <input
                          ref={searchInputRef}
                          type="text"
                          placeholder="Search courses..."
                          value={searchQuery}
                          onChange={(e) => onSearchChange(e.target.value)}
                          onBlur={() => {
                            if (!searchQuery) setIsSearchExpanded(false);
                          }}
                          className="px-3 py-2 bg-transparent border-none outline-none text-sm w-40 sm:w-64 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                        />
                        <button
                          onClick={() => {
                            onSearchChange('');
                            setIsSearchExpanded(false);
                          }}
                          className="pr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ) : (
                      <motion.button
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        onClick={() => setIsSearchExpanded(true)}
                        className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 rounded-xl transition-all"
                        title="Search Courses"
                      >
                        <Search className="w-5 h-5" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {activeCourse && (
                <div className="flex items-center gap-1 sm:gap-2 mr-2 pr-2 sm:mr-4 sm:pr-4 border-r border-slate-200 dark:border-slate-700">
                  <button
                    onClick={handleOpenAnnouncements}
                    className="relative p-2 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 dark:hover:text-amber-400 rounded-xl transition-all"
                    title="Announcements"
                  >
                    <Bell className="w-5 h-5" />
                    {hasUnreadAnnouncements && (
                      <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full"></span>
                    )}
                  </button>
                  <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    className={`p-2 rounded-xl transition-all ${
                      isChatOpen 
                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' 
                        : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400'
                    }`}
                    title="Group Chat"
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>
                </div>
              )}

              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full">
                {user.role === 'teacher' ? (
                  <Presentation className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <GraduationCap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                )}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{user.name}</span>
              </div>
              
              <button
                onClick={onToggleDarkMode}
                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 dark:hover:text-indigo-400 rounded-full transition-colors"
                title="Toggle Dark Mode"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              <button
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:hover:text-red-400 rounded-full transition-colors"
                title="Log out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {activeCourse && (
        <>
          <AnnouncementModal
            isOpen={isAnnouncementOpen}
            onClose={() => setIsAnnouncementOpen(false)}
            courseId={activeCourse.id}
            userRole={user.role}
          />
          <GroupChat
            courseId={activeCourse.id}
            userId={user.id}
            userName={user.name}
            userRole={user.role}
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
          />
        </>
      )}
    </>
  );
}
