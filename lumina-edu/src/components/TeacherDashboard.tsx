import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Loader2, CheckCircle2, HelpCircle, Plus, BookOpen, ChevronRight, Bell, Trash2, PanelLeftClose, PanelLeftOpen, BarChart3, RotateCcw, AlertCircle, Sparkles, Edit2, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import QuizViewer from './QuizViewer';
import { supabase } from '../lib/supabase';
import { Course } from './CourseList';
import { GoogleGenAI, Type } from '@google/genai';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface Chapter {
  id: string;
  course_id: string;
  title: string;
  file_uri: string | null;
  mime_type: string | null;
  ppt: any;
  quiz: any[];
}

export interface Announcement {
  id: string;
  course_id: string;
  title: string;
  content: string;
  created_at: string;
}

interface TeacherDashboardProps {
  course: Course;
  user: { id: string; role: 'teacher' | 'student'; name: string };
}

export default function TeacherDashboard({ course, user }: TeacherDashboardProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [isCreatingChapter, setIsCreatingChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);

  // Editing states
  const [isEditingChapterTitle, setIsEditingChapterTitle] = useState(false);
  const [editedChapterTitle, setEditedChapterTitle] = useState('');
  const [isEditingCourseInfo, setIsEditingCourseInfo] = useState(false);
  const [editedCourseName, setEditedCourseName] = useState(course.name);
  const [editedCourseDescription, setEditedCourseDescription] = useState(course.description);

  useEffect(() => {
    fetchChapters();
  }, [course.id]);

  const fetchChapters = async () => {
    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('course_id', course.id)
      .order('created_at', { ascending: true });
      
    if (data) {
      setChapters(data);
      if (data.length > 0 && !activeChapterId) {
        setActiveChapterId(data[0].id);
      }
    }
  };

  const [activeTab, setActiveTab] = useState<'material' | 'quiz' | 'analytics'>('material');
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);

  useEffect(() => {
    if (activeChapterId && activeTab === 'analytics') {
      fetchSubmissions();
    }
  }, [activeChapterId, activeTab]);

  const fetchSubmissions = async () => {
    setIsLoadingSubmissions(true);
    try {
      const { data, error } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('chapter_id', activeChapterId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setSubmissions(data || []);
    } catch (err) {
      console.error('Error fetching submissions:', err);
    } finally {
      setIsLoadingSubmissions(false);
    }
  };

  const activeChapter = chapters.find(c => c.id === activeChapterId);

  const calculateAnalytics = () => {
    if (submissions.length === 0 || !activeChapter?.quiz) return null;
    
    const totalStudents = new Set(submissions.map(s => s.student_id)).size;
    const avgScore = (submissions.reduce((acc, s) => acc + s.score, 0) / submissions.length).toFixed(1);
    
    // Calculate accuracy per question
    const questionStats = activeChapter.quiz.map((q: any, qIdx: number) => {
      const correctCount = submissions.filter(s => s.answers[qIdx] === q.correctAnswerIndex).length;
      const accuracy = (correctCount / submissions.length) * 100;
      return {
        question: q.question,
        accuracy: accuracy.toFixed(1),
        isLowAccuracy: accuracy < 50
      };
    });

    return {
      totalCompletions: submissions.length,
      totalStudents,
      avgScore,
      questionStats
    };
  };

  const analytics = calculateAnalytics();

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterTitle.trim()) return;

    const { data, error } = await supabase
      .from('chapters')
      .insert([{
        course_id: course.id,
        title: newChapterTitle.trim(),
        quiz: []
      }])
      .select()
      .single();

    if (data) {
      setChapters([...chapters, data]);
      setActiveChapterId(data.id);
      setNewChapterTitle('');
      setIsCreatingChapter(false);
    } else {
      console.error(error);
      alert('Failed to create chapter. Please ensure you have run the updated SQL schema.');
    }
  };

  const updateChapter = async (id: string, updates: Partial<Chapter>) => {
    const { error } = await supabase
      .from('chapters')
      .update(updates)
      .eq('id', id);
      
    if (!error) {
      setChapters(chapters.map(c => c.id === id ? { ...c, ...updates } : c));
    } else {
      console.error('Failed to update chapter:', error);
      alert(`Failed to update chapter: ${error.message}`);
      throw error;
    }
  };

  const handleUpdateChapterTitle = async () => {
    if (!activeChapterId || !editedChapterTitle.trim()) return;
    await updateChapter(activeChapterId, { title: editedChapterTitle.trim() });
    setIsEditingChapterTitle(false);
  };

  const handleUpdateCourseInfo = async () => {
    if (!editedCourseName.trim()) return;
    
    const { error } = await supabase
      .from('courses')
      .update({
        name: editedCourseName.trim(),
        description: editedCourseDescription.trim()
      })
      .eq('id', course.id);

    if (!error) {
      alert('Course information updated successfully!');
      setIsEditingCourseInfo(false);
      window.location.reload(); 
    } else {
      console.error(error);
      alert('Failed to update course information.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChapterId) return;

    setIsUploading(true);
    setUploadProgress(10);

    try {
      // 1. Upload to Supabase Storage for permanent cloud hosting
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${course.id}/${fileName}`;

      setUploadProgress(30);
      const { error: uploadError } = await supabase.storage
        .from('course-materials')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw new Error('Failed to upload file to cloud storage. Please ensure the "course-materials" bucket exists in Supabase.');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('course-materials')
        .getPublicUrl(filePath);

      setUploadProgress(60);

      // 2. Update database record
      await updateChapter(activeChapterId, {
        file_uri: publicUrl,
        mime_type: file.type,
        ppt: {
          supabaseUrl: publicUrl,
          originalName: file.name
        },
        quiz: []
      });
      
      setUploadProgress(100);
      
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(error.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const generateQuiz = async (force = false) => {
    if (!activeChapter?.ppt?.supabaseUrl || !activeChapterId) return;

    // Add confirmation if quiz already exists (regeneration)
    if (activeChapter.quiz && activeChapter.quiz.length > 0 && !force) {
      setShowRegenConfirm(true);
      return;
    }

    setShowRegenConfirm(false);
    setIsGeneratingQuiz(true);
    try {
      // 1. Delete existing submissions for this chapter
      const { error: deleteError } = await supabase
        .from('quiz_submissions')
        .delete()
        .eq('chapter_id', activeChapterId);
      
      if (deleteError) throw deleteError;

      // 2. Fetch the file and convert to base64
      const fileResponse = await fetch(activeChapter.ppt.supabaseUrl);
      const blob = await fileResponse.blob();
      
      const reader = new FileReader();
      const fileBase64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const fileBase64 = await fileBase64Promise;
      
      const prompt = `Based on the provided document, generate exactly 10 multiple-choice questions. 
      Output MUST be a JSON array of objects with this exact structure:
      [
        {
          "question": "The question text",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswerIndex": 0, // index of the correct option (0-3)
          "explanation": "Detailed explanation of why this is correct"
        }
      ]
      Ensure the questions cover the core concepts of the document.`;
      
      const response = await genAI.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: fileBase64,
                  mimeType: activeChapter.mime_type || 'application/pdf'
                }
              },
              { text: prompt }
            ]
          }
        ]
      });

      const text = response.text;
      
      // Clean up JSON if model wrapped it in markdown
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const quizData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);

      // Ensure correctAnswerIndex is a number
      const sanitizedQuizData = quizData.map((q: any) => ({
        ...q,
        correctAnswerIndex: Number(q.correctAnswerIndex)
      }));

      await updateChapter(activeChapterId, { quiz: sanitizedQuizData });
      
      // Refresh submissions (should be empty now)
      setSubmissions([]);
      if (activeTab === 'analytics') {
        fetchSubmissions();
      }
    } catch (error: any) {
      console.error('Error generating Quiz:', error);
      alert(`Failed to generate Quiz: ${error.message}`);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Left Sidebar: Chapters List */}
      {isLeftSidebarOpen && (
        <div className="w-80 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full transition-all">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 ml-2">
              <BookOpen className="w-5 h-5 text-indigo-600" />
              Chapters
            </h3>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsCreatingChapter(true)}
                className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                title="Add Chapter"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsLeftSidebarOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                title="Close Sidebar"
              >
                <PanelLeftClose className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isCreatingChapter && (
              <form onSubmit={handleCreateChapter} className="mb-4">
                <input
                  type="text"
                  autoFocus
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  placeholder="Chapter title..."
                  className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-2 mt-2">
                  <button type="submit" className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Save</button>
                  <button type="button" onClick={() => setIsCreatingChapter(false)} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200">Cancel</button>
                </div>
              </form>
            )}

            {chapters.length === 0 && !isCreatingChapter ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No chapters yet. Click + to add one.
              </div>
            ) : (
              chapters.map((chapter, idx) => (
                <button
                  key={chapter.id}
                  onClick={() => {
                    setActiveChapterId(chapter.id);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between group transition-all ${
                    activeChapterId === chapter.id 
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-900' 
                      : 'hover:bg-slate-50 border border-transparent text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      activeChapterId === chapter.id ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {idx + 1}
                    </div>
                    <span className="font-medium truncate">{chapter.title}</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 ${activeChapterId === chapter.id ? 'text-indigo-400' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`} />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Right Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto pr-2 space-y-8">
        {!activeChapter ? (
          <div className="bg-white p-12 rounded-2xl shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center h-full relative">
            <div className="flex items-center gap-4 absolute top-8 left-8">
              {!isLeftSidebarOpen && (
                <button 
                  onClick={() => setIsLeftSidebarOpen(true)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                  title="Open Sidebar"
                >
                  <PanelLeftOpen className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="bg-indigo-50 p-4 rounded-full mb-4">
              <BookOpen className="w-12 h-12 text-indigo-300" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-800 mb-2">Select or Create a Chapter</h2>
            <p className="text-slate-500 max-w-md mb-8">
              Organize your course into chapters. Each chapter can have its own PDF/PPT material and quiz.
            </p>

            <div className="w-full max-w-2xl bg-slate-50 rounded-2xl p-8 border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800">Course Information</h3>
                {!isEditingCourseInfo ? (
                  <button 
                    onClick={() => {
                      setEditedCourseName(course.name);
                      setEditedCourseDescription(course.description);
                      setIsEditingCourseInfo(true);
                    }}
                    className="flex items-center gap-2 text-sm text-indigo-600 font-semibold hover:text-indigo-700"
                  >
                    <Edit2 size={16} />
                    Edit Info
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button 
                      onClick={handleUpdateCourseInfo}
                      className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                    >
                      <Check size={18} />
                    </button>
                    <button 
                      onClick={() => setIsEditingCourseInfo(false)}
                      className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>

              {isEditingCourseInfo ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Course Name</label>
                    <input 
                      type="text"
                      value={editedCourseName}
                      onChange={(e) => setEditedCourseName(e.target.value)}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Description</label>
                    <textarea 
                      value={editedCourseDescription}
                      onChange={(e) => setEditedCourseDescription(e.target.value)}
                      rows={4}
                      className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-left">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Course Name</p>
                    <p className="text-slate-800 font-medium">{course.name}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Description</p>
                    <p className="text-slate-600 leading-relaxed">{course.description || 'No description provided.'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 relative">
              <div className="flex items-center gap-4 absolute top-8 left-8">
                {!isLeftSidebarOpen && (
                  <button 
                    onClick={() => setIsLeftSidebarOpen(true)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                    title="Open Sidebar"
                  >
                    <PanelLeftOpen className="w-5 h-5" />
                  </button>
                )}
              </div>
              <div className={`flex items-center gap-4 mb-6 ${!isLeftSidebarOpen ? 'ml-12' : ''}`}>
                <div className="flex-1 flex items-center gap-2">
                  <FileText className="text-indigo-500 flex-shrink-0" />
                  {isEditingChapterTitle ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input 
                        type="text"
                        autoFocus
                        value={editedChapterTitle}
                        onChange={(e) => setEditedChapterTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateChapterTitle()}
                        className="flex-1 text-2xl font-semibold bg-slate-50 border-b-2 border-indigo-500 outline-none px-1"
                      />
                      <button 
                        onClick={handleUpdateChapterTitle}
                        className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                      >
                        <Check size={20} />
                      </button>
                      <button 
                        onClick={() => setIsEditingChapterTitle(false)}
                        className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 group">
                      <h2 className="text-2xl font-semibold text-slate-800">
                        {activeChapter.title}
                      </h2>
                      <button 
                        onClick={() => {
                          setEditedChapterTitle(activeChapter.title);
                          setIsEditingChapterTitle(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        title="Rename Chapter"
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex border-b border-slate-200 mb-8">
                <button
                  onClick={() => setActiveTab('material')}
                  className={`px-6 py-3 font-medium text-sm transition-all border-b-2 ${
                    activeTab === 'material' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Course Material
                </button>
                <button
                  onClick={() => setActiveTab('quiz')}
                  className={`px-6 py-3 font-medium text-sm transition-all border-b-2 ${
                    activeTab === 'quiz' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Chapter Quiz
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className={`px-6 py-3 font-medium text-sm transition-all border-b-2 ${
                    activeTab === 'analytics' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Analytics
                </button>
              </div>
              
              {activeTab === 'material' && (
                <>
                  {!activeChapter.ppt?.supabaseUrl ? (
                    <div 
                      className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept="application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                        onChange={handleFileUpload}
                      />
                      {isUploading ? (
                        <div className="flex flex-col items-center gap-4">
                          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                          <p className="text-slate-600 font-medium">Uploading and processing document... {uploadProgress}%</p>
                          <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-indigo-500 transition-all duration-300"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-4">
                          <div className="bg-indigo-50 p-4 rounded-full">
                            <UploadCloud className="w-8 h-8 text-indigo-600" />
                          </div>
                          <div>
                            <p className="text-lg font-medium text-slate-700">Upload Teaching Material (PDF or PPT)</p>
                            <p className="text-sm text-slate-500 mt-1">Drag and drop or click to browse</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 p-4 rounded-xl">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="text-emerald-500 w-6 h-6" />
                        <div>
                          <p className="font-medium text-emerald-900">Document Uploaded Successfully</p>
                          <p className="text-sm text-emerald-700">
                            {activeChapter.ppt?.originalName || 'Ready for students'}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => updateChapter(activeChapterId, { file_uri: null, mime_type: null, ppt: null, quiz: [] })}
                        className="text-sm text-slate-500 hover:text-slate-700 underline"
                      >
                        Upload another
                      </button>
                    </div>
                  )}

                  {activeChapter.ppt?.supabaseUrl && (
                    <div className="mt-8">
                      <button
                        onClick={generateQuiz}
                        disabled={isGeneratingQuiz || (activeChapter.quiz && activeChapter.quiz.length > 0) || !activeChapter.file_uri}
                        className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isGeneratingQuiz ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Generating 10 Questions...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            Generate AI Quiz
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'quiz' && (
                <div className="space-y-6">
                  {!activeChapter.quiz || activeChapter.quiz.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-slate-700 mb-2">No Quiz Generated</h3>
                      <p className="text-slate-500 mb-6 max-w-sm mx-auto">
                        Generate a customized quiz based on your course material using AI.
                      </p>
                      <button
                        onClick={generateQuiz}
                        disabled={isGeneratingQuiz || !activeChapter.file_uri}
                        className="inline-flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                      >
                        {isGeneratingQuiz ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Generating 10 Questions...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-5 h-5" />
                            Generate AI Quiz
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
                            {activeChapter.quiz.length} Questions
                          </span>
                          <span className="text-slate-400 text-sm">•</span>
                          <span className="text-slate-500 text-sm italic">AI Generated</span>
                        </div>
                        <button
                          onClick={() => generateQuiz()}
                          disabled={isGeneratingQuiz}
                          className="text-sm text-indigo-600 font-semibold hover:text-indigo-700 flex items-center gap-1 disabled:opacity-50"
                        >
                          {isGeneratingQuiz ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                          {isGeneratingQuiz ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>
                      <QuizViewer questions={activeChapter.quiz} isTeacherView={true} />
                    </div>
                  )}

                  {/* Custom Confirmation Modal */}
                  <AnimatePresence>
                    {showRegenConfirm && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-md w-full"
                        >
                          <div className="bg-amber-50 w-12 h-12 rounded-full flex items-center justify-center mb-4">
                            <RotateCcw className="text-amber-600 w-6 h-6" />
                          </div>
                          <h3 className="text-xl font-bold text-slate-800 mb-2">Regenerate Quiz?</h3>
                          <p className="text-slate-600 mb-6">
                            Regenerating the quiz will <span className="font-bold text-red-600">delete all current student submissions</span> and scores for this chapter. This action cannot be undone.
                          </p>
                          <div className="flex gap-3">
                            <button
                              onClick={() => generateQuiz(true)}
                              className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all"
                            >
                              Yes, Regenerate
                            </button>
                            <button
                              onClick={() => setShowRegenConfirm(false)}
                              className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {activeTab === 'analytics' && (
                <div className="space-y-8">
                  {isLoadingSubmissions ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p>Loading analytics data...</p>
                    </div>
                  ) : !analytics ? (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <BarChart3 className="w-8 h-8 text-slate-300" />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-700 mb-2">No Submissions Yet</h3>
                      <p className="text-slate-500 max-w-sm mx-auto">
                        Once students complete the quiz for this chapter, you'll see their performance metrics here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Metric Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                          <p className="text-slate-500 text-sm font-medium mb-1 uppercase tracking-wider">Total Completions</p>
                          <div className="flex items-end gap-2">
                            <span className="text-4xl font-black text-slate-800">{analytics.totalCompletions}</span>
                            <span className="text-slate-400 text-sm mb-1">attempts</span>
                          </div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                          <p className="text-slate-500 text-sm font-medium mb-1 uppercase tracking-wider">Average Score</p>
                          <div className="flex items-end gap-2">
                            <span className="text-4xl font-black text-indigo-600">{analytics.avgScore}</span>
                            <span className="text-slate-400 text-sm mb-1">/ {activeChapter.quiz.length}</span>
                          </div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                          <p className="text-slate-500 text-sm font-medium mb-1 uppercase tracking-wider">Unique Students</p>
                          <div className="flex items-end gap-2">
                            <span className="text-4xl font-black text-emerald-600">{analytics.totalStudents}</span>
                            <span className="text-slate-400 text-sm mb-1">enrolled</span>
                          </div>
                        </div>
                      </div>

                      {/* Low Accuracy Questions */}
                      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                          <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-amber-500" />
                            Question Performance
                          </h3>
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Accuracy Rate</span>
                        </div>
                        <div className="divide-y divide-slate-50">
                          {analytics.questionStats.map((stat: any, idx: number) => (
                            <div key={idx} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                              <div className="flex gap-4 items-start max-w-[70%]">
                                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {idx + 1}
                                </span>
                                <p className="text-slate-700 font-medium line-clamp-2">{stat.question}</p>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden hidden sm:block">
                                  <div 
                                    className={`h-full transition-all duration-500 ${
                                      stat.isLowAccuracy ? 'bg-red-500' : 'bg-emerald-500'
                                    }`} 
                                    style={{ width: `${stat.accuracy}%` }}
                                  ></div>
                                </div>
                                <span className={`font-black text-lg w-16 text-right ${
                                  stat.isLowAccuracy ? 'text-red-500' : 'text-emerald-600'
                                }`}>
                                  {stat.accuracy}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Recent Submissions Table */}
                      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-50 bg-slate-50/50">
                          <h3 className="font-bold text-slate-800">Recent Submissions</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50">
                                <th className="px-6 py-4">Student</th>
                                <th className="px-6 py-4">Score</th>
                                <th className="px-6 py-4">Date</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {submissions.slice(0, 5).map((sub) => (
                                <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-4 font-semibold text-slate-700">{sub.student_name}</td>
                                  <td className="px-6 py-4">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                      sub.score >= activeChapter.quiz.length / 2 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                      {sub.score} / {activeChapter.quiz.length}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-slate-500 text-sm">
                                    {new Date(sub.created_at).toLocaleDateString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
