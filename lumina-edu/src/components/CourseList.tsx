import React, { useState } from 'react';
import { BookOpen, Plus, Search, Users, Presentation, ArrowRight, Hash, Edit2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface Course {
  id: string;
  name: string;
  code: string;
  description: string;
  teacherName: string;
}

interface CourseListProps {
  role: 'teacher' | 'student';
  userName: string;
  courses: Course[];
  onSelectCourse: (course: Course) => void;
  onCreateCourse: (name: string, description: string) => void;
  onJoinCourse: (code: string) => void;
  onUpdateCourse: (id: string, name: string, description: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export default function CourseList({ role, userName, courses, onSelectCourse, onCreateCourse, onJoinCourse, onUpdateCourse, searchQuery, onSearchChange }: CourseListProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDesc, setNewCourseDesc] = useState('');
  const [editCourseName, setEditCourseName] = useState('');
  const [editCourseDesc, setEditCourseDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const filteredCourses = courses.filter(course => 
    course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    course.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCourseName.trim()) {
      onCreateCourse(newCourseName.trim(), newCourseDesc.trim());
      setNewCourseName('');
      setNewCourseDesc('');
      setIsCreating(false);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.trim()) {
      onJoinCourse(joinCode.trim());
      setJoinCode('');
      setIsJoining(false);
    }
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCourse && editCourseName.trim()) {
      onUpdateCourse(editingCourse.id, editCourseName.trim(), editCourseDesc.trim());
      setEditingCourse(null);
    }
  };

  const openEditModal = (e: React.MouseEvent, course: Course) => {
    e.stopPropagation();
    setEditingCourse(course);
    setEditCourseName(course.name);
    setEditCourseDesc(course.description);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Welcome back, {userName}</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {role === 'teacher' ? 'Manage your courses and teaching materials' : 'Continue your learning journey'}
          </p>
        </div>
        
        {role === 'teacher' ? (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-medium transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Create Course
          </button>
        ) : (
          <button
            onClick={() => setIsJoining(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition-colors shadow-sm"
          >
            <Hash className="w-5 h-5" />
            Join Course
          </button>
        )}
      </div>

      {/* Create Course Modal */}
      {isCreating && role === 'teacher' && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <motion.div 
            initial={{ scale: 0.95 }} animate={{ scale: 1 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700"
          >
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Create New Course</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Course Name</label>
                <input
                  type="text" required value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="e.g. Advanced Physics 101"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Description</label>
                <textarea
                  value={newCourseDesc} onChange={(e) => setNewCourseDesc(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none resize-none h-24"
                  placeholder="Brief description of the course..."
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsCreating(false)} className="flex-1 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors">Create</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}

      {/* Join Course Modal */}
      {isJoining && role === 'student' && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <motion.div 
            initial={{ scale: 0.95 }} animate={{ scale: 1 }}
            className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700"
          >
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Join a Course</h2>
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Course Code</label>
                <input
                  type="text" required value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-lg tracking-widest uppercase text-center"
                  placeholder="e.g. A1B2C3"
                  maxLength={6}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 text-center">Ask your teacher for the 6-character course code.</p>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsJoining(false)} className="flex-1 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">Join Class</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}

      {/* Edit Course Modal */}
      <AnimatePresence>
        {editingCourse && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Edit Course</h2>
                <button onClick={() => setEditingCourse(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleUpdate} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Course Name</label>
                  <input
                    type="text" required value={editCourseName} onChange={(e) => setEditCourseName(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-1">Description</label>
                  <textarea
                    value={editCourseDesc} onChange={(e) => setEditCourseDesc(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-24"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setEditingCourse(null)} className="flex-1 px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">Save Changes</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Course Grid */}
      {filteredCourses.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm">
          {searchQuery ? (
            <>
              <Search className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300">No matching courses</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-2">Try searching for a different course name or code.</p>
              <button 
                onClick={() => onSearchChange('')}
                className="mt-4 text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
              >
                Clear search
              </button>
            </>
          ) : (
            <>
              <BookOpen className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300">No courses yet</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">
                {role === 'teacher' 
                  ? "You haven't created any courses. Click 'Create Course' to get started and generate a course code for your students."
                  : "You haven't joined any courses. Ask your teacher for a course code and click 'Join Course'."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map((course) => (
            <motion.div
              key={course.id}
              whileHover={{ y: -4 }}
              onClick={() => onSelectCourse(course)}
              className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl ${role === 'teacher' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
                  <BookOpen className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-2">
                  {role === 'teacher' && (
                    <>
                      <button
                        onClick={(e) => openEditModal(e, course)}
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-all"
                        title="Edit Course"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <div className="bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-lg flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Code</span>
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{course.code}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                {course.name}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm line-clamp-2 mb-6 h-10">
                {course.description || "No description provided."}
              </p>
              
              <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <Presentation className="w-4 h-4" />
                  <span>{course.teacherName}</span>
                </div>
                <ArrowRight className={`w-5 h-5 ${role === 'teacher' ? 'text-emerald-500' : 'text-indigo-500'} opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0 duration-300`} />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
