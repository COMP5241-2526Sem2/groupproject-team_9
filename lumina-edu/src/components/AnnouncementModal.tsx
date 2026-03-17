import React, { useState, useEffect } from 'react';
import { X, Bell, Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Announcement } from './TeacherDashboard';

interface AnnouncementModalProps {
  isOpen: boolean;
  onClose: () => void;
  courseId: string;
  userRole: 'teacher' | 'student';
  onRead?: () => void;
}

export default function AnnouncementModal({ isOpen, onClose, courseId, userRole, onRead }: AnnouncementModalProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchAnnouncements();
      if (onRead) onRead();
    }
  }, [isOpen, courseId]);

  const fetchAnnouncements = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('announcements')
        .select('*')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      if (data) setAnnouncements(data);
    } catch (err: any) {
      console.error('Error fetching announcements:', err);
      setError('Failed to load announcements. Please ensure the database is updated.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const { data, error } = await supabase
      .from('announcements')
      .insert([{ course_id: courseId, title: newTitle, content: newContent }])
      .select()
      .single();

    if (data) {
      setAnnouncements([data, ...announcements]);
      setNewTitle('');
      setNewContent('');
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', id);

    if (!error) {
      setAnnouncements(announcements.filter(a => a.id !== id));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-600 rounded-xl">
              <Bell className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Course Announcements</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {userRole === 'teacher' && (
            <div className="mb-8">
              {!isCreating ? (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 font-medium"
                >
                  <Plus className="w-5 h-5" />
                  Post New Announcement
                </button>
              ) : (
                <form onSubmit={handleCreate} className="bg-slate-50 p-4 rounded-xl border border-slate-200 animate-in slide-in-from-top-2">
                  <input
                    type="text"
                    placeholder="Announcement Title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full px-4 py-2 mb-3 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    required
                  />
                  <textarea
                    placeholder="Details..."
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    className="w-full px-4 py-2 mb-4 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                    required
                  />
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                    >
                      Post Announcement
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>Loading announcements...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <div className="bg-red-50 p-3 rounded-full mb-3">
                <X className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm text-red-600 font-medium mb-2">{error}</p>
              <button 
                onClick={fetchAnnouncements}
                className="text-xs text-indigo-600 font-bold hover:underline"
              >
                Retry
              </button>
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Bell className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No announcements yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((announcement) => (
                <div key={announcement.id} className="p-5 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-shadow relative group">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-slate-800 text-lg">{announcement.title}</h3>
                    <span className="text-xs text-slate-400">{new Date(announcement.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-slate-600 whitespace-pre-wrap leading-relaxed">{announcement.content}</p>
                  {userRole === 'teacher' && (
                    <button
                      onClick={() => handleDelete(announcement.id)}
                      className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete announcement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
