import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, AlertCircle, Presentation, HelpCircle, BookOpen, ChevronRight, Bell, Download, FileText, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import QuizViewer from './QuizViewer';
import { supabase } from '../lib/supabase';
import { Course } from './CourseList';
import { Chapter, Announcement } from './TeacherDashboard';
import { GoogleGenAI } from '@google/genai';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface Message {
  role: 'user' | 'model';
  content: string;
}

interface StudentTutorProps {
  course: Course;
  user: { id: string; role: 'teacher' | 'student'; name: string };
}

export default function StudentTutor({ course, user }: StudentTutorProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeContentTab, setActiveContentTab] = useState<'material' | 'quiz'>('material');
  const [submission, setSubmission] = useState<any>(null);
  const [isLoadingSubmission, setIsLoadingSubmission] = useState(false);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);

  useEffect(() => {
    fetchChapters();

    // Subscribe to chapter changes
    const chapterSubscription = supabase
      .channel('chapters_changes')
      .on(
        'postgres_changes', 
        { 
          event: '*', 
          schema: 'public',
          table: 'chapters', 
          filter: `course_id=eq.${course.id}` 
        }, 
        () => {
          fetchChapters();
        }
      )
      .subscribe();

    // Subscribe to submission changes
    const submissionSubscription = supabase
      .channel('submission_changes')
      .on(
        'postgres_changes', 
        { 
          event: '*', 
          schema: 'public',
          table: 'quiz_submissions', 
          filter: `student_id=eq.${user.id}` 
        }, 
        () => {
          fetchSubmission();
        }
      )
      .subscribe();

    return () => {
      chapterSubscription.unsubscribe();
      submissionSubscription.unsubscribe();
    };
  }, [course.id, user.id]);

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

  const activeChapter = chapters.find(c => c.id === activeChapterId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Reset chat when chapter changes
  useEffect(() => {
    setMessages([]);
    if (activeChapterId) {
      fetchSubmission();
    }
  }, [activeChapterId]);

  const fetchSubmission = async () => {
    if (!activeChapterId || !user.id) return;
    setIsLoadingSubmission(true);
    try {
      const { data, error } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('chapter_id', activeChapterId)
        .eq('student_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      setSubmission(data);
    } catch (err) {
      console.error('Error fetching submission:', err);
    } finally {
      setIsLoadingSubmission(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isStreaming || !activeChapter) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const contents: any[] = [];
      
      // Add history to contents
      messages.forEach(msg => {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });

      const userParts: any[] = [{ text: userMessage }];

      // If there's a file, fetch it and add to the current user message parts
      if (activeChapter.ppt?.supabaseUrl) {
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
        userParts.unshift({
          inlineData: {
            data: fileBase64,
            mimeType: activeChapter.mime_type || 'application/pdf'
          }
        });
      }

      contents.push({
        role: 'user',
        parts: userParts
      });

      const result = await genAI.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: contents,
        config: {
          systemInstruction: "You are a helpful AI tutor. Use the provided PDF document to answer the student's questions accurately. If the answer is in the document, refer to it. If not, use your general knowledge but clarify that it's not in the text."
        }
      });

      setMessages((prev) => [...prev, { role: 'model', content: '' }]);
      setIsLoading(false);
      setIsStreaming(true);

      let aiMessage = '';
      for await (const chunk of result) {
        const chunkText = chunk.text;
        aiMessage += chunkText;
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = aiMessage;
          return newMessages;
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'model', content: 'Sorry, I encountered an error while processing your request.' },
      ]);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  const renderDocument = () => {
    if (!activeChapter?.ppt?.supabaseUrl) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500">
          <Presentation className="w-12 h-12 mb-4 opacity-20" />
          <p>Material not available yet.</p>
        </div>
      );
    }

    const isPdf = activeChapter.mime_type === 'application/pdf' || activeChapter.ppt?.originalName?.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(activeChapter.ppt.supabaseUrl)}&embedded=true`;
      return (
        <iframe 
          src={googleDocsUrl} 
          className="w-full h-full rounded-b-2xl border-none" 
          title="PDF Viewer" 
        />
      );
    } else {
      // For PPT/PPTX/DOCX etc., use Office Web Viewer
      const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(activeChapter.ppt.supabaseUrl)}`;
      return (
        <iframe 
          src={officeUrl} 
          className="w-full h-full rounded-b-2xl border-none" 
          title="Document Viewer" 
        />
      );
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
            <button 
              onClick={() => setIsLeftSidebarOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              title="Close Sidebar"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {chapters.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No chapters available yet.
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

      {/* Main Content Area */}
      <div className="flex-1 flex gap-6 min-w-0 h-full">
        {!activeChapter ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center bg-white rounded-2xl border border-slate-200 p-8">
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
            <div className="bg-amber-50 p-6 rounded-full mb-6">
              <AlertCircle className="w-12 h-12 text-amber-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Waiting for Content</h2>
            <p className="text-slate-600 max-w-md">
              Please select a chapter from the left sidebar to start learning.
            </p>
          </div>
        ) : (
          <>
            {/* Middle Panel: Content Viewer */}
            <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full min-w-0">
              <div className="flex items-center border-b border-slate-200 bg-slate-50">
                {!isLeftSidebarOpen && (
                  <button 
                    onClick={() => setIsLeftSidebarOpen(true)}
                    className="ml-2 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
                    title="Open Sidebar"
                  >
                    <PanelLeftOpen className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => setActiveContentTab('material')}
                  className={`flex-1 py-4 px-4 font-medium text-sm transition-colors ${
                    activeContentTab === 'material'
                      ? 'bg-white text-indigo-600 border-b-2 border-indigo-600'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Course Material
                </button>
                <button
                  onClick={() => setActiveContentTab('quiz')}
                  className={`flex-1 py-4 px-4 font-medium text-sm transition-colors ${
                    activeContentTab === 'quiz'
                      ? 'bg-white text-violet-600 border-b-2 border-violet-600'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Practice Quiz
                </button>
                {!isRightSidebarOpen && (
                  <button 
                    onClick={() => setIsRightSidebarOpen(true)}
                    className="mr-2 p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg flex items-center gap-2"
                    title="Open AI Tutor"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="text-sm font-medium">AI Tutor</span>
                  </button>
                )}
              </div>
              
              <div className="flex-1 overflow-hidden bg-slate-50/50">
                {activeContentTab === 'material' ? (
                  renderDocument()
                ) : (
                  <div className="h-full overflow-y-auto p-6">
                    {isLoadingSubmission ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400">
                        <Loader2 className="w-8 h-8 animate-spin mb-4" />
                        <p>Loading quiz status...</p>
                      </div>
                    ) : activeChapter.quiz && activeChapter.quiz.length > 0 ? (
                      <QuizViewer 
                        questions={activeChapter.quiz} 
                        isTeacherView={false} 
                        chapterId={activeChapter.id}
                        studentId={user.id}
                        studentName={user.name}
                        initialSubmission={submission}
                        onComplete={() => fetchSubmission()}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <HelpCircle className="w-12 h-12 mb-4 opacity-20" />
                        <p>Quiz not available yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: AI Tutor Chat */}
            {isRightSidebarOpen && (
              <div className="w-96 flex-shrink-0 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full transition-all">
                <div className="p-4 border-b border-slate-200 bg-emerald-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-100 p-2 rounded-lg">
                      <Sparkles className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-emerald-900">AI Tutor</h3>
                      <p className="text-xs text-emerald-700 truncate max-w-[180px]">Ask about {activeChapter.title}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsRightSidebarOpen(false)}
                    className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg"
                    title="Close AI Tutor"
                  >
                    <PanelRightClose className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50">
                  {messages.length === 0 && (
                    <div className="text-center text-slate-500 mt-10">
                      <Bot className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p className="text-sm">Hi! I'm your AI Tutor. I'm ready to help you understand {activeChapter.title}.</p>
                    </div>
                  )}
                  
                  <AnimatePresence initial={false}>
                    {messages.map((msg, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                      >
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                          msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
                        }`}>
                          {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                        </div>
                        <div className={`max-w-[80%] rounded-2xl p-4 ${
                          msg.role === 'user' 
                            ? 'bg-indigo-600 text-white rounded-tr-none' 
                            : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                        }`}>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {isLoading && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                        <Bot size={16} />
                      </div>
                      <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                        <span className="text-sm text-slate-500">Thinking...</span>
                      </div>
                    </motion.div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-4 bg-white border-t border-slate-200">
                  <form onSubmit={handleSendMessage} className="relative">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask a question about the material..."
                      className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                      disabled={isLoading || isStreaming}
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading || isStreaming}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
