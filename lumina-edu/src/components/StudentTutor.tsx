import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  AlertCircle,
  Presentation,
  HelpCircle,
  BookOpen,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  CheckCircle2,
  Clock3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import QuizViewer from './QuizViewer';
import { supabase } from '../lib/supabase';
import { Course } from './CourseList';
import { Chapter } from './TeacherDashboard';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface StudentTutorProps {
  course: Course;
  user: { id: string; role: 'teacher' | 'student'; name: string };
}

type ChapterStatus = 'idle' | 'queued' | 'processing' | 'ready' | 'failed';

const CHAT_TIMEOUT_MS = 120000;
const PAGE_SUMMARY_TIMEOUT_MS = 120000;

const PROCESSING_STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  extracting_text: 'Extracting text',
  parsing_document: 'Parsing document',
  chunking: 'Chunking content',
  generating_reading: 'Generating relevant reading',
  generating_quiz: 'Generating quiz',
  finalizing: 'Finalizing',
  completed: 'Completed',
  failed: 'Failed',
};

function normalizeStatus(chapter?: Chapter | null): ChapterStatus {
  if (!chapter) return 'idle';

  const raw = String(
    (chapter as any).content_status || chapter.extract_status || 'idle'
  ).toLowerCase();

  if (raw === 'ready' || raw === 'completed') return 'ready';
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'queued') return 'queued';

  if (
    [
      'processing',
      'extracting',
      'extracting_text',
      'parsing_document',
      'chunking',
      'generating_reading',
      'generating_quiz',
      'finalizing',
    ].includes(raw)
  ) {
    return 'processing';
  }

  return 'idle';
}

function getStageLabel(chapter?: Chapter | null) {
  if (!chapter) return 'Idle';

  const stage = String(
    (chapter as any).processing_stage ||
      (chapter as any).content_status ||
      chapter.extract_status ||
      'idle'
  ).toLowerCase();

  return PROCESSING_STAGE_LABELS[stage] || stage.replace(/_/g, ' ') || 'Idle';
}

function getProgress(chapter?: Chapter | null) {
  if (!chapter) return 0;

  const raw = Number((chapter as any).processing_progress ?? 0);
  if (!Number.isNaN(raw) && raw >= 0) return Math.min(100, Math.max(0, raw));

  const status = normalizeStatus(chapter);
  if (status === 'ready') return 100;
  if (status === 'queued') return 5;
  return 0;
}

function isPdfChapter(chapter?: Chapter | null) {
  if (!chapter) return false;

  return (
    chapter.mime_type === 'application/pdf' ||
    chapter.ppt?.originalName?.toLowerCase().endsWith('.pdf') === true
  );
}

function isPptxChapter(chapter?: Chapter | null) {
  if (!chapter) return false;

  return (
    chapter.mime_type ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    chapter.ppt?.originalName?.toLowerCase().endsWith('.pptx') === true
  );
}

function createTimedAbortController(timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeoutId),
    didTimeout: () => didTimeout,
  };
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    return '';
  }
}

async function readJsonSafely(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateText(text: string, maxLen = 240) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

export default function StudentTutor({ course, user }: StudentTutorProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [pageNumberInput, setPageNumberInput] = useState('1');
  const [pageSummary, setPageSummary] = useState<string | null>(null);
  const [pageSummaryError, setPageSummaryError] = useState<string | null>(null);
  const [isPageSummaryLoading, setIsPageSummaryLoading] = useState(false);

  const [activeContentTab, setActiveContentTab] = useState<'material' | 'reading' | 'quiz'>('material');
  const [submission, setSubmission] = useState<any>(null);
  const [isLoadingSubmission, setIsLoadingSubmission] = useState(false);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(384);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  const mountedRef = useRef(true);
  const activeChapterIdRef = useRef<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const pageSummaryAbortRef = useRef<AbortController | null>(null);
  const chatRequestIdRef = useRef(0);
  const pageSummaryRequestIdRef = useRef(0);

  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || null,
    [chapters, activeChapterId]
  );

  const activeChapterStatus = normalizeStatus(activeChapter);
  const activeChapterProgress = getProgress(activeChapter);
  const activeChapterStageLabel = getStageLabel(activeChapter);

  const tutorAvailable = activeChapterStatus === 'ready';
  const pageSummarySupported = isPptxChapter(activeChapter);

  const readingAvailable =
    activeChapterStatus === 'ready' &&
    !!activeChapter?.ppt?.relevant_reading &&
    !!activeChapter?.ppt?.is_reading_published;

  const quizAvailable =
    activeChapterStatus === 'ready' &&
    !!activeChapter?.quiz &&
    activeChapter.quiz.length > 0;

  const fetchChapters = useCallback(async () => {
    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('course_id', course.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching chapters:', error);
      return [];
    }

    const nextChapters = (data || []) as Chapter[];

    if (!mountedRef.current) return nextChapters;

    setChapters(nextChapters);

    setActiveChapterId((prev) => {
      if (nextChapters.length === 0) return null;
      if (!prev) return nextChapters[0].id;
      if (!nextChapters.some((chapter) => chapter.id === prev)) {
        return nextChapters[0].id;
      }
      return prev;
    });

    return nextChapters;
  }, [course.id]);

  const fetchSubmission = useCallback(async (chapterId?: string | null) => {
    const targetChapterId = chapterId ?? activeChapterId;
    if (!targetChapterId || !user.id) return;

    setIsLoadingSubmission(true);
    try {
      const { data, error } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('chapter_id', targetChapterId)
        .eq('student_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (!mountedRef.current) return;

      setSubmission(data);
    } catch (err) {
      console.error('Error fetching submission:', err);
    } finally {
      if (mountedRef.current) {
        setIsLoadingSubmission(false);
      }
    }
  }, [activeChapterId, user.id]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    activeChapterIdRef.current = activeChapterId;
  }, [activeChapterId]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchChapters();

    return () => {
      mountedRef.current = false;
      chatAbortRef.current?.abort();
      pageSummaryAbortRef.current?.abort();
      chatRequestIdRef.current += 1;
      pageSummaryRequestIdRef.current += 1;
    };
  }, [fetchChapters]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const newWidth = Math.max(200, Math.min(e.clientX - 32, 600));
        setLeftWidth(newWidth);
      } else if (isDraggingRight) {
        const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX - 32, 800));
        setRightWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingLeft, isDraggingRight]);

  useEffect(() => {
    const chapterSubscription = supabase
      .channel(`student-chapters-${course.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chapters',
          filter: `course_id=eq.${course.id}`,
        },
        () => {
          void fetchChapters();
        }
      )
      .subscribe();

    const submissionSubscription = supabase
      .channel(`student-submission-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_submissions',
          filter: `student_id=eq.${user.id}`,
        },
        () => {
          void fetchSubmission();
        }
      )
      .subscribe();

    return () => {
      chapterSubscription.unsubscribe();
      submissionSubscription.unsubscribe();
    };
  }, [course.id, user.id, fetchChapters, fetchSubmission]);

  useEffect(() => {
    if (!activeChapter) return;

    const status = normalizeStatus(activeChapter);
    if (!['queued', 'processing'].includes(status)) return;

    const interval = setInterval(() => {
      void fetchChapters();
    }, 3000);

    return () => clearInterval(interval);
  }, [activeChapter, fetchChapters]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    chatRequestIdRef.current += 1;
    pageSummaryRequestIdRef.current += 1;

    setMessages([]);
    setPageSummary(null);
    setPageSummaryError(null);
    setPageNumberInput('1');
    setSubmission(null);

    chatAbortRef.current?.abort();
    pageSummaryAbortRef.current?.abort();
    setIsLoading(false);
    setIsPageSummaryLoading(false);

    if (activeChapterId) {
      void fetchSubmission(activeChapterId);
    }
  }, [activeChapterId, fetchSubmission]);

  useEffect(() => {
    if (activeContentTab === 'reading' && !readingAvailable) {
      setActiveContentTab('material');
    }
  }, [activeContentTab, readingAvailable]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeChapter) return;

    const userMessage = input.trim();
    const chapterIdAtRequestStart = activeChapter.id;
    const requestId = ++chatRequestIdRef.current;
    const nextHistory: Message[] = [...messages, { role: 'user', content: userMessage }];

    setInput('');
    setMessages(nextHistory);

    if (!activeChapter.ppt?.supabaseUrl) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'No chapter material is available yet, so I cannot answer based on the document.',
        },
      ]);
      return;
    }

    if (activeChapterStatus !== 'ready') {
      const statusMessage =
        activeChapterStatus === 'failed'
          ? `This chapter could not be processed successfully, so the AI Tutor is temporarily unavailable.`
          : `This chapter is still being prepared. Current stage: **${activeChapterStageLabel}** (${activeChapterProgress}%). Please try again shortly.`;

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: statusMessage,
        },
      ]);
      return;
    }

    setIsLoading(true);

    chatAbortRef.current?.abort();
    const abortCtx = createTimedAbortController(CHAT_TIMEOUT_MS);
    const controller = abortCtx.controller;
    chatAbortRef.current = controller;

    try {
      const response = await fetch('/api/qwen-chat-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          chapterId: activeChapter.id,
          question: userMessage,
          history: nextHistory,
        }),
        signal: controller.signal,
      });

      const text = await readResponseText(response);
      const result = await readJsonSafely(text);

      if (!result) {
        throw new Error(`API did not return valid JSON: ${truncateText(text, 200)}`);
      }

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Failed to get response from AI tutor.');
      }

      if (!mountedRef.current) return;
      if (chatRequestIdRef.current !== requestId) return;
      if (activeChapterIdRef.current !== chapterIdAtRequestStart) return;

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.answer || 'Sorry, I could not generate a response.',
        },
      ]);
    } catch (error: any) {
      console.error('Chat error:', error);

      if (!mountedRef.current) return;
      if (chatRequestIdRef.current !== requestId) return;

      if (error?.name === 'AbortError' && !abortCtx.didTimeout()) {
        return;
      }

      const errorMessage =
        error?.name === 'AbortError'
          ? 'The request took too long. Please try again, or ask a shorter and more specific question.'
          : error?.message || 'Sorry, I encountered an error while processing your request.';

      if (activeChapterIdRef.current !== chapterIdAtRequestStart) {
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: errorMessage,
        },
      ]);
    } finally {
      abortCtx.clear();
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
      if (mountedRef.current && chatRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  };

  const handleGeneratePageSummary = async () => {
    if (!activeChapter) return;

    const pageNumber = Number(pageNumberInput);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      setPageSummary(null);
      setPageSummaryError('Please enter a valid page number (1 or higher).');
      return;
    }

    if (!activeChapter.ppt?.supabaseUrl) {
      setPageSummary(null);
      setPageSummaryError('No chapter material is available yet.');
      return;
    }

    if (activeChapterStatus !== 'ready') {
      setPageSummary(null);
      setPageSummaryError(
        activeChapterStatus === 'failed'
          ? 'This chapter failed processing, so summaries are unavailable.'
          : 'This chapter is still being processed. Please try again soon.'
      );
      return;
    }

    if (!pageSummarySupported) {
      setPageSummary(null);
      setPageSummaryError(
        isPdfChapter(activeChapter)
          ? 'Page Summary currently supports PPTX slides only. PDF files are not supported yet.'
          : 'Page Summary is currently available only for PPTX slides.'
      );
      return;
    }

    const normalizedPageNumber = Math.floor(pageNumber);
    const chapterIdAtRequestStart = activeChapter.id;
    const requestId = ++pageSummaryRequestIdRef.current;

    setIsPageSummaryLoading(true);
    setPageSummary('');
    setPageSummaryError(null);

    pageSummaryAbortRef.current?.abort();
    const abortCtx = createTimedAbortController(PAGE_SUMMARY_TIMEOUT_MS);
    const controller = abortCtx.controller;
    pageSummaryAbortRef.current = controller;

    try {
      const response = await fetch(
        `/api/chapters/${encodeURIComponent(activeChapter.id)}/page-summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ pageNumber: normalizedPageNumber }),
          signal: controller.signal,
        }
      );

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const text = await readResponseText(response);
      const result = await readJsonSafely(text);

      if (!result) {
        throw new Error(
          `Page Summary API returned an unexpected ${contentType || 'unknown'} response: ${truncateText(
            text || `HTTP ${response.status}`,
            240
          )}`
        );
      }

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Failed to generate summary.');
      }

      if (!mountedRef.current) return;
      if (pageSummaryRequestIdRef.current !== requestId) return;
      if (activeChapterIdRef.current !== chapterIdAtRequestStart) return;

      setPageSummary(result.summary || 'No summary was generated.');
    } catch (error: any) {
      console.error('Page summary error:', error);

      if (!mountedRef.current) return;
      if (pageSummaryRequestIdRef.current !== requestId) return;

      if (error?.name === 'AbortError' && !abortCtx.didTimeout()) {
        return;
      }

      if (activeChapterIdRef.current !== chapterIdAtRequestStart) {
        return;
      }

      const errorMessage =
        error?.name === 'AbortError'
          ? 'The summary request took too long. Please try again in a moment.'
          : error?.message || 'Sorry, I encountered an error while generating the summary.';

      setPageSummary(null);
      setPageSummaryError(errorMessage);
    } finally {
      abortCtx.clear();
      if (pageSummaryAbortRef.current === controller) {
        pageSummaryAbortRef.current = null;
      }
      if (mountedRef.current && pageSummaryRequestIdRef.current === requestId) {
        setIsPageSummaryLoading(false);
      }
    }
  };

  const renderDocument = () => {
    if (!activeChapter?.ppt?.supabaseUrl) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400">
          <Presentation className="w-12 h-12 mb-4 opacity-20" />
          <p>Material not available yet.</p>
        </div>
      );
    }

    const isPdf = isPdfChapter(activeChapter);

    if (isPdf) {
      const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(
        activeChapter.ppt.supabaseUrl
      )}&embedded=true`;

      return (
        <iframe
          src={googleDocsUrl}
          className="w-full h-full rounded-b-2xl border-none"
          title="PDF Viewer"
        />
      );
    }

    const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
      activeChapter.ppt.supabaseUrl
    )}`;

    return (
      <iframe
        src={officeUrl}
        className="w-full h-full rounded-b-2xl border-none"
        title="Document Viewer"
      />
    );
  };

  const renderChapterBadge = (chapter: Chapter) => {
    const status = normalizeStatus(chapter);

    if (status === 'ready') {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold uppercase tracking-wider">
          Ready
        </span>
      );
    }

    if (status === 'failed') {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-bold uppercase tracking-wider">
          Failed
        </span>
      );
    }

    if (status === 'queued' || status === 'processing') {
      return (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold uppercase tracking-wider">
          {getProgress(chapter)}%
        </span>
      );
    }

    return null;
  };

  const renderStatusPanel = () => {
    if (!activeChapter?.ppt?.supabaseUrl) return null;

    if (activeChapterStatus === 'ready') {
      return (
        <div className="mx-6 mt-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30 p-4 rounded-xl">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="text-emerald-500 dark:text-emerald-400 w-5 h-5 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-900 dark:text-emerald-100">Chapter Ready</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                The material has been processed and the AI Tutor is available for this chapter.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (activeChapterStatus === 'failed') {
      return (
        <div className="mx-6 mt-6 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 p-4 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-500 dark:text-red-400 w-5 h-5 mt-0.5" />
            <div>
              <p className="font-medium text-red-900 dark:text-red-100">Chapter Processing Failed</p>
              <p className="text-sm text-red-700 dark:text-red-300">
                {(activeChapter as any).processing_error ||
                  'This chapter is temporarily unavailable because processing failed.'}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (activeChapterStatus === 'queued' || activeChapterStatus === 'processing') {
      return (
        <div className="mx-6 mt-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 p-4 rounded-xl">
          <div className="flex items-start gap-3">
            <Clock3 className="text-amber-500 dark:text-amber-400 w-5 h-5 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-900 dark:text-amber-100">Chapter is Being Prepared</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                Current stage: <span className="font-medium">{activeChapterStageLabel}</span>
              </p>
              <div className="w-full h-2 bg-amber-100 dark:bg-amber-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${activeChapterProgress}%` }}
                />
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                {activeChapterProgress}% completed
              </p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] relative">
      {isLeftSidebarOpen && (
        <div
          style={{ width: leftWidth }}
          className="flex-shrink-0 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full transition-none relative z-10"
        >
          <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 ml-2">
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
              <div className="text-center py-8 text-slate-500 text-sm">No chapters available yet.</div>
            ) : (
              chapters.map((chapter, idx) => (
                <button
                  key={chapter.id}
                  onClick={() => {
                    setActiveChapterId(chapter.id);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl group transition-all border ${
                    activeChapterId === chapter.id
                      ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 border-transparent text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 overflow-hidden min-w-0">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 mt-0.5 ${
                          activeChapterId === chapter.id
                            ? 'bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{chapter.title}</span>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {renderChapterBadge(chapter)}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 flex-shrink-0 mt-1 ${
                        activeChapterId === chapter.id
                          ? 'text-indigo-400 dark:text-indigo-500'
                          : 'text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'
                      }`}
                    />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {isLeftSidebarOpen && (
        <div
          className="w-4 cursor-col-resize flex-shrink-0 flex items-center justify-center group z-20"
          onMouseDown={() => setIsDraggingLeft(true)}
        >
          <div className="w-1 h-8 bg-slate-200 dark:bg-slate-700 rounded-full group-hover:bg-indigo-400 dark:group-hover:bg-indigo-500 transition-colors"></div>
        </div>
      )}
      {!isLeftSidebarOpen && <div className="w-4 flex-shrink-0"></div>}

      <div className="flex-1 flex min-w-0 h-full relative z-10">
        {!activeChapter ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 shadow-sm">
            <div className="flex items-center gap-4 absolute top-8 left-8">
              {!isLeftSidebarOpen && (
                <button
                  onClick={() => setIsLeftSidebarOpen(true)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                  title="Open Sidebar"
                >
                  <PanelLeftOpen className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/30 p-6 rounded-full mb-6">
              <AlertCircle className="w-12 h-12 text-amber-500 dark:text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-2">Waiting for Content</h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-md">
              Please select a chapter from the left sidebar to start learning.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden h-full min-w-0 relative">
            {(isDraggingLeft || isDraggingRight) && <div className="absolute inset-0 z-50 bg-transparent"></div>}

            <div className="flex items-center border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto">
              {!isLeftSidebarOpen && (
                <button
                  onClick={() => setIsLeftSidebarOpen(true)}
                  className="ml-2 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg flex-shrink-0"
                  title="Open Sidebar"
                >
                  <PanelLeftOpen className="w-5 h-5" />
                </button>
              )}

              <button
                onClick={() => setActiveContentTab('material')}
                className={`flex-1 py-4 px-4 font-medium text-sm transition-colors whitespace-nowrap ${
                  activeContentTab === 'material'
                    ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                Teaching Material
              </button>

              {readingAvailable && (
                <button
                  onClick={() => setActiveContentTab('reading')}
                  className={`flex-1 py-4 px-4 font-medium text-sm transition-colors whitespace-nowrap ${
                    activeContentTab === 'reading'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  Relevant Reading
                </button>
              )}

              <button
                onClick={() => setActiveContentTab('quiz')}
                className={`flex-1 py-4 px-4 font-medium text-sm transition-colors whitespace-nowrap ${
                  activeContentTab === 'quiz'
                    ? 'bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-400 border-b-2 border-violet-600 dark:border-violet-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
              >
                Practice Quiz
              </button>

              {!isRightSidebarOpen && (
                <button
                  onClick={() => setIsRightSidebarOpen(true)}
                  className="mr-2 p-2 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-lg flex items-center gap-2 flex-shrink-0"
                  title="Open AI Tutor"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="text-sm font-medium">AI Tutor</span>
                </button>
              )}
            </div>

            {renderStatusPanel()}

            <div className="flex-1 overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
              {activeContentTab === 'material' ? (
                renderDocument()
              ) : activeContentTab === 'reading' ? (
                readingAvailable ? (
                  <div className="h-full overflow-y-auto p-8 bg-white dark:bg-slate-800">
                    <div className="max-w-3xl mx-auto">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="bg-indigo-100 dark:bg-indigo-900/50 p-3 rounded-xl">
                          <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">Relevant Reading</h2>
                          <p className="text-slate-500 dark:text-slate-400">
                            Supplementary materials curated by your teacher and AI.
                          </p>
                        </div>
                      </div>
                      <div className="prose prose-slate dark:prose-invert max-w-none prose-indigo">
                        <Markdown>{activeChapter.ppt?.relevant_reading}</Markdown>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 p-8 text-center">
                    <BookOpen className="w-12 h-12 mb-4 opacity-20" />
                    <p>Relevant reading is not available for this chapter yet.</p>
                  </div>
                )
              ) : (
                <div className="h-full overflow-y-auto p-6 bg-white dark:bg-slate-800">
                  {activeChapterStatus !== 'ready' ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400 text-center">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p>
                        This chapter is still being prepared. Quiz access will be available once processing is complete.
                      </p>
                    </div>
                  ) : isLoadingSubmission ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p>Loading quiz status...</p>
                    </div>
                  ) : quizAvailable ? (
                    <QuizViewer
                      questions={activeChapter.quiz}
                      isTeacherView={false}
                      chapterId={activeChapter.id}
                      studentId={user.id}
                      studentName={user.name}
                      initialSubmission={submission}
                      onComplete={() => void fetchSubmission()}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400">
                      <HelpCircle className="w-12 h-12 mb-4 opacity-20" />
                      <p>Quiz not available yet.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isRightSidebarOpen && activeChapter && (
        <div
          className="w-4 cursor-col-resize flex-shrink-0 flex items-center justify-center group z-20"
          onMouseDown={() => setIsDraggingRight(true)}
        >
          <div className="w-1 h-8 bg-slate-200 dark:bg-slate-700 rounded-full group-hover:bg-emerald-400 dark:group-hover:bg-emerald-500 transition-colors"></div>
        </div>
      )}
      {!isRightSidebarOpen && activeChapter && <div className="w-4 flex-shrink-0"></div>}

      {isRightSidebarOpen && activeChapter && (
        <div
          style={{ width: rightWidth }}
          className="flex-shrink-0 flex flex-col bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden h-full transition-none relative z-10"
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-100 dark:bg-emerald-900/50 p-2 rounded-lg">
                <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">AI Tutor</h3>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 truncate max-w-[180px]">
                  Ask about {activeChapter.title}
                </p>
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

          {!tutorAvailable && (
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-amber-50 dark:bg-amber-900/20">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 dark:text-amber-400 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100">AI Tutor not ready yet</p>
                  <p className="text-amber-700 dark:text-amber-300">
                    {activeChapterStatus === 'failed'
                      ? 'This chapter failed to process, so the AI Tutor is unavailable.'
                      : `Current stage: ${activeChapterStageLabel} (${activeChapterProgress}%).`}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex-shrink-0 p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="flex items-center gap-2 mb-2">
              <Presentation className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Slide Page Summary
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={pageNumberInput}
                onChange={(e) => setPageNumberInput(e.target.value)}
                className="w-24 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                disabled={isPageSummaryLoading || !tutorAvailable || !pageSummarySupported}
                aria-label="Page number"
              />
              <button
                type="button"
                onClick={handleGeneratePageSummary}
                disabled={isPageSummaryLoading || !tutorAvailable || !pageSummarySupported}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPageSummaryLoading ? 'Generating...' : 'Generate Summary'}
              </button>
            </div>

            {!pageSummarySupported && tutorAvailable && (
              <div className="mt-3 text-sm text-amber-600 dark:text-amber-400">
                Page Summary currently supports PPTX slides only.
              </div>
            )}

            {isPageSummaryLoading && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating summary...</span>
              </div>
            )}

            {pageSummaryError && (
              <div className="mt-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-lg p-3">
                {pageSummaryError}
              </div>
            )}
          </div>

          {pageSummary !== null && !pageSummaryError && (
            <div className="flex-1 overflow-y-auto bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-100 dark:border-emerald-800/30 p-4">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-emerald">
                <Markdown>{pageSummary}</Markdown>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50 dark:bg-slate-900/50">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 dark:text-slate-400 mt-10">
                <Bot className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="text-sm">
                  Hi! I&apos;m your AI Tutor. I&apos;m ready to help you understand {activeChapter.title}.
                </p>
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
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                      msg.role === 'user'
                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'
                        : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl p-4 ${
                      msg.role === 'user'
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 text-indigo-900 dark:text-indigo-100 rounded-tr-none shadow-sm'
                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-tl-none shadow-sm'
                    }`}
                  >
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <Bot size={16} />
                </div>
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm text-slate-500 dark:text-slate-400">Thinking...</span>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
            <form onSubmit={handleSendMessage} className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  tutorAvailable
                    ? 'Ask a question about the material...'
                    : 'AI Tutor will be available after processing is complete'
                }
                className="w-full pl-4 pr-12 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                disabled={isLoading || !tutorAvailable}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading || !tutorAvailable}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}