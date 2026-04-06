import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  HelpCircle,
  Plus,
  BookOpen,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  RotateCcw,
  AlertCircle,
  Edit2,
  Check,
  X,
  Eye,
  EyeOff,
  Clock3,
  Presentation,
} from 'lucide-react';
import QuizViewer from './QuizViewer';
import { supabase } from '../lib/supabase';
import { Course } from './CourseList';
import Markdown from 'react-markdown';

type ChapterStatus = 'idle' | 'queued' | 'processing' | 'ready' | 'failed';

interface ChapterPptMeta {
  supabaseUrl?: string;
  originalName?: string;
  storagePath?: string;
  relevant_reading?: string | null;
  is_reading_published?: boolean;
  last_processed_at?: string | null;
}

export interface Chapter {
  id: string;
  course_id: string;
  title: string;
  file_uri: string | null;
  mime_type: string | null;
  ppt: ChapterPptMeta | null;
  quiz: any[];
  extracted_text?: string | null;

  content_status?: string | null;
  processing_stage?: string | null;
  processing_progress?: number | null;
  processing_error?: string | null;

  extract_status?: string | null;
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

function parseSseFrame(frame: string) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return {
    event,
    data: dataLines.join('\n'),
  };
}

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

  const raw = String(chapter.content_status || chapter.extract_status || 'idle').toLowerCase();

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
    chapter.processing_stage ||
      chapter.content_status ||
      chapter.extract_status ||
      'idle'
  ).toLowerCase();

  return PROCESSING_STAGE_LABELS[stage] || stage.replace(/_/g, ' ') || 'Idle';
}

function getProgress(chapter?: Chapter | null) {
  if (!chapter) return 0;

  const raw = Number(chapter.processing_progress ?? 0);
  if (!Number.isNaN(raw) && raw >= 0) return Math.min(100, Math.max(0, raw));

  const status = normalizeStatus(chapter);
  if (status === 'ready') return 100;
  if (status === 'queued') return 5;
  return 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderDocument(chapter: Chapter) {
  if (!chapter?.ppt?.supabaseUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-400">
        <FileText className="w-12 h-12 mb-4 opacity-20" />
        <p>Material not available yet.</p>
      </div>
    );
  }

  const isPdf =
    chapter.mime_type === 'application/pdf' ||
    chapter.ppt?.originalName?.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const googleDocsUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(
      chapter.ppt.supabaseUrl
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
    chapter.ppt.supabaseUrl
  )}`;

  return (
    <iframe
      src={officeUrl}
      className="w-full h-full rounded-b-2xl border-none"
      title="Document Viewer"
    />
  );
}

export default function TeacherDashboard({ course }: TeacherDashboardProps) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  const [isCreatingChapter, setIsCreatingChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);

  const [isEditingChapterTitle, setIsEditingChapterTitle] = useState(false);
  const [editedChapterTitle, setEditedChapterTitle] = useState('');

  const [activeTab, setActiveTab] = useState<'material' | 'reading' | 'quiz' | 'analytics'>('material');

  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState(false);

  const [editingReading, setEditingReading] = useState('');
  const [isEditingReading, setIsEditingReading] = useState(false);

  const [pageNumberInput, setPageNumberInput] = useState('1');
  const [pageSummary, setPageSummary] = useState<string | null>(null);
  const [pageSummaryError, setPageSummaryError] = useState<string | null>(null);
  const [isPageSummaryLoading, setIsPageSummaryLoading] = useState(false);

  const mountedRef = useRef(true);
  const pageSummaryAbortRef = useRef<AbortController | null>(null);
  const processingTriggerRef = useRef<Record<string, boolean>>({});
  const processingMonitorRef = useRef<Record<string, boolean>>({});

  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || null,
    [chapters, activeChapterId]
  );

  const activeChapterStatus = normalizeStatus(activeChapter);
  const activeChapterProgress = getProgress(activeChapter);
  const activeChapterStageLabel = getStageLabel(activeChapter);

  const upsertChapterIntoState = useCallback((nextChapter: Chapter) => {
    if (!mountedRef.current) return;

    setChapters((prev) => {
      const idx = prev.findIndex((c) => c.id === nextChapter.id);
      if (idx === -1) return [...prev, nextChapter];

      const cloned = [...prev];
      cloned[idx] = {
        ...cloned[idx],
        ...nextChapter,
      };
      return cloned;
    });
  }, []);

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

    const next = (data || []) as Chapter[];

    if (mountedRef.current) {
      setChapters(next);
    }

    return next;
  }, [course.id]);

  const fetchSubmissions = useCallback(async () => {
    if (!activeChapterId) return;

    setIsLoadingSubmissions(true);
    try {
      const { data, error } = await supabase
        .from('quiz_submissions')
        .select('*')
        .eq('chapter_id', activeChapterId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (mountedRef.current) {
        setSubmissions(data || []);
      }
    } catch (err) {
      console.error('Error fetching submissions:', err);
    } finally {
      if (mountedRef.current) {
        setIsLoadingSubmissions(false);
      }
    }
  }, [activeChapterId]);

  const fetchSingleChapter = useCallback(async (chapterId: string) => {
    const { data, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('id', chapterId)
      .single();

    if (error) {
      console.error('Error fetching single chapter:', error);
      return null;
    }

    const chapter = data as Chapter;
    upsertChapterIntoState(chapter);
    return chapter;
  }, [upsertChapterIntoState]);

  const startMonitoringChapterStatus = useCallback(
    async (
      chapterId: string,
      options?: {
        maxAttempts?: number;
        intervalMs?: number;
        showFailureAlert?: boolean;
      }
    ) => {
      if (processingMonitorRef.current[chapterId]) return;

      processingMonitorRef.current[chapterId] = true;

      const maxAttempts = options?.maxAttempts ?? 40;
      const intervalMs = options?.intervalMs ?? 3000;
      const showFailureAlert = options?.showFailureAlert ?? true;

      try {
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const latest = await fetchSingleChapter(chapterId);

          if (!latest) {
            await sleep(intervalMs);
            continue;
          }

          const status = normalizeStatus(latest);

          if (status === 'ready') {
            return latest;
          }

          if (status === 'failed') {
            if (showFailureAlert) {
              alert(
                latest.processing_error ||
                  'The chapter processing failed. Please try again.'
              );
            }
            return latest;
          }

          if (status === 'queued' || status === 'processing') {
            await sleep(intervalMs);
            continue;
          }

          if (attempt < 4) {
            await sleep(intervalMs);
            continue;
          }

          return latest;
        }

        return await fetchSingleChapter(chapterId);
      } finally {
        delete processingMonitorRef.current[chapterId];
      }
    },
    [fetchSingleChapter]
  );

  const markChapterAsQueuedLocally = useCallback((chapter: Chapter) => {
    upsertChapterIntoState({
      ...chapter,
      content_status: 'queued',
      processing_stage: 'queued',
      processing_progress: Math.max(5, Number(chapter.processing_progress || 0)),
      processing_error: null,
    });
  }, [upsertChapterIntoState]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchChapters();

    return () => {
      pageSummaryAbortRef.current?.abort();
      mountedRef.current = false;
    };
  }, [fetchChapters]);

  useEffect(() => {
    if (activeChapterId && activeTab === 'analytics') {
      void fetchSubmissions();
    }
  }, [activeChapterId, activeTab, fetchSubmissions]);

  useEffect(() => {
    if (chapters.length === 0) {
      setActiveChapterId(null);
      return;
    }

    if (!activeChapterId || !chapters.some((c) => c.id === activeChapterId)) {
      setActiveChapterId(chapters[0].id);
    }
  }, [chapters, activeChapterId]);

  useEffect(() => {
    const chapterSubscription = supabase
      .channel(`teacher-chapters-${course.id}`)
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
      .channel(`teacher-submissions-${course.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_submissions',
        },
        () => {
          if (activeTab === 'analytics' && activeChapterId) {
            void fetchSubmissions();
          }
        }
      )
      .subscribe();

    return () => {
      chapterSubscription.unsubscribe();
      submissionSubscription.unsubscribe();
    };
  }, [course.id, activeTab, activeChapterId, fetchChapters, fetchSubmissions]);

  useEffect(() => {
    if (!activeChapter) return;

    const status = normalizeStatus(activeChapter);
    if (!['queued', 'processing'].includes(status)) return;

    const interval = setInterval(() => {
      void fetchChapters();
      if (activeTab === 'analytics' && activeChapterId) {
        void fetchSubmissions();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeChapter, activeTab, activeChapterId, fetchChapters, fetchSubmissions]);

  useEffect(() => {
    setPageSummary(null);
    setPageSummaryError(null);
    setPageNumberInput('1');
  }, [activeChapterId]);

  const calculateAnalytics = () => {
    if (submissions.length === 0 || !activeChapter?.quiz?.length) return null;

    const totalStudents = new Set(submissions.map((s) => s.student_id)).size;
    const avgScore = (
      submissions.reduce((acc, s) => acc + s.score, 0) / submissions.length
    ).toFixed(1);

    const questionStats = activeChapter.quiz.map((q: any, qIdx: number) => {
      const correctCount = submissions.filter(
        (s) => s.answers?.[qIdx] === q.correctAnswerIndex
      ).length;
      const accuracy = submissions.length ? (correctCount / submissions.length) * 100 : 0;

      return {
        question: q.question,
        accuracy: accuracy.toFixed(1),
        isLowAccuracy: accuracy < 50,
      };
    });

    return {
      totalCompletions: submissions.length,
      totalStudents,
      avgScore,
      questionStats,
    };
  };

  const analytics = calculateAnalytics();

  const updateChapter = async (id: string, updates: Partial<Chapter>) => {
    const { error } = await supabase.from('chapters').update(updates).eq('id', id);

    if (error) {
      console.error('Failed to update chapter:', error);
      alert(`Failed to update chapter: ${error.message}`);
      throw error;
    }

    setChapters((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterTitle.trim()) return;

    const { data, error } = await supabase
      .from('chapters')
      .insert([
        {
          course_id: course.id,
          title: newChapterTitle.trim(),
          quiz: [],
          ppt: null,
          extracted_text: null,
          content_status: 'idle',
          processing_stage: null,
          processing_progress: 0,
          processing_error: null,
        },
      ])
      .select()
      .single();

    if (error || !data) {
      console.error(error);
      alert('Failed to create chapter. Please ensure your latest SQL schema has been applied.');
      return;
    }

    setChapters((prev) => [...prev, data as Chapter]);
    setActiveChapterId(data.id);
    setNewChapterTitle('');
    setIsCreatingChapter(false);
  };

  const handleUpdateChapterTitle = async () => {
    if (!activeChapterId || !editedChapterTitle.trim()) return;
    await updateChapter(activeChapterId, { title: editedChapterTitle.trim() });
    setIsEditingChapterTitle(false);
  };

  const triggerAutoProcessing = async (
    chapter: Chapter,
    fileMeta: { fileUrl: string; fileName: string; mimeType: string }
  ) => {
    if (processingTriggerRef.current[chapter.id]) {
      console.warn('[triggerAutoProcessing] duplicate blocked', chapter.id);
      return;
    }

    processingTriggerRef.current[chapter.id] = true;

    markChapterAsQueuedLocally(chapter);

    try {
      const response = await fetch('/api/process-chapter-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          fileUrl: fileMeta.fileUrl,
          fileName: fileMeta.fileName,
          mimeType: fileMeta.mimeType,
        }),
      });

      const rawText = await response.text();
      let result: any = null;

      try {
        result = rawText ? JSON.parse(rawText) : null;
      } catch {
        console.error('[triggerAutoProcessing] non-JSON response:', rawText);
      }

      console.log('[triggerAutoProcessing] response status:', response.status);
      console.log('[triggerAutoProcessing] response body:', result || rawText);

      if (response.ok && result?.ok) {
        await fetchChapters();

        const latest = await fetchSingleChapter(chapter.id);
        const latestStatus = normalizeStatus(latest);

        if (latestStatus === 'queued' || latestStatus === 'processing') {
          void startMonitoringChapterStatus(chapter.id, {
            maxAttempts: 120,
            intervalMs: 3000,
            showFailureAlert: true,
          });
        }

        return;
      }

      if (response.status === 504) {
        console.warn(
          '[triggerAutoProcessing] 504 received; continuing to monitor chapter status instead of failing immediately.'
        );

        await fetchChapters();
        void startMonitoringChapterStatus(chapter.id, {
          maxAttempts: 120,
          intervalMs: 3000,
          showFailureAlert: true,
        });
        return;
      }

      const latest = await fetchSingleChapter(chapter.id);
      const latestStatus = normalizeStatus(latest);

      if (
        latestStatus === 'queued' ||
        latestStatus === 'processing' ||
        latestStatus === 'ready'
      ) {
        console.warn(
          '[triggerAutoProcessing] non-OK response but chapter is already progressing; continuing to monitor.',
          {
            responseStatus: response.status,
            latestStatus,
          }
        );

        void startMonitoringChapterStatus(chapter.id, {
          maxAttempts: 120,
          intervalMs: 3000,
          showFailureAlert: true,
        });
        return;
      }

      throw new Error(
        result?.error ||
          `Processing request failed with status ${response.status}`
      );
    } catch (error: any) {
      console.error('Auto processing trigger failed:', error);

      const latest = await fetchSingleChapter(chapter.id);
      const latestStatus = normalizeStatus(latest);

      if (
        latestStatus === 'queued' ||
        latestStatus === 'processing' ||
        latestStatus === 'ready'
      ) {
        console.warn(
          '[triggerAutoProcessing] request errored, but chapter is progressing; continuing to monitor.'
        );

        void startMonitoringChapterStatus(chapter.id, {
          maxAttempts: 120,
          intervalMs: 3000,
          showFailureAlert: true,
        });
        return;
      }

      const errorMessage =
        error?.message || 'Processing request did not complete normally. Please check again in a moment.';

      alert(errorMessage);
    } finally {
      processingTriggerRef.current[chapter.id] = false;
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

    if (activeChapterStatus !== 'ready') {
      setPageSummary(null);
      setPageSummaryError(
        activeChapterStatus === 'failed'
          ? 'This chapter failed processing, so a summary cannot be generated.'
          : 'This chapter is still being processed. Please try again later.'
      );
      return;
    }

    if (!activeChapter.ppt?.supabaseUrl) {
      setPageSummary(null);
      setPageSummaryError('No document has been uploaded for this chapter yet.');
      return;
    }

    setIsPageSummaryLoading(true);
    setPageSummary('');
    setPageSummaryError(null);

    pageSummaryAbortRef.current?.abort();
    const controller = new AbortController();
    pageSummaryAbortRef.current = controller;

    try {
      const response = await fetch(
        `/api/chapters/${encodeURIComponent(activeChapter.id)}/page-summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageNumber: Math.floor(pageNumber) }),
          signal: controller.signal,
        }
      );

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        const text = await response.text();
        let result: any = null;

        try {
          result = JSON.parse(text);
        } catch {
          throw new Error(text || 'Failed to generate summary.');
        }

        throw new Error(result?.error || 'Failed to generate summary.');
      }

      if (contentType.includes('application/json')) {
        const text = await response.text();
        let result: any = null;

        try {
          result = JSON.parse(text);
        } catch {
          throw new Error(`The API returned invalid JSON: ${text.slice(0, 200)}`);
        }

        if (!result?.ok) {
          throw new Error(result?.error || 'Failed to generate summary.');
        }

        if (!mountedRef.current) return;
        setPageSummary(result.summary || 'No summary was generated.');
        return;
      }

      if (!response.body) {
        throw new Error('Summary stream is not readable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDelta = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const separator = buffer.indexOf('\n\n');
          if (separator === -1) break;

          const frame = buffer.slice(0, separator).trim();
          buffer = buffer.slice(separator + 2);

          if (!frame || frame.startsWith(':')) continue;

          const { event, data } = parseSseFrame(frame);
          if (!data) continue;

          let payload: any = null;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (event === 'delta') {
            const chunk = String(payload?.text || '');
            if (!chunk) continue;

            sawDelta = true;
            if (!mountedRef.current) continue;

            setPageSummary((prev) => `${prev || ''}${chunk}`);
            continue;
          }

          if (event === 'error') {
            throw new Error(payload?.error || 'Failed to generate summary.');
          }

          if (event === 'done' && !sawDelta && mountedRef.current) {
            setPageSummary(String(payload?.summary || 'No summary was generated.'));
          }
        }
      }

      if (!mountedRef.current) return;

      setPageSummary((prev) => {
        if (prev && prev.trim()) return prev;
        return 'No summary was generated.';
      });
    } catch (error: any) {
      console.error('Page summary error:', error);
      const errorMessage =
        error?.name === 'AbortError'
          ? 'The summary request was cancelled.'
          : error?.message || 'An error occurred while generating the summary.';
      setPageSummaryError(errorMessage);
    } finally {
      if (pageSummaryAbortRef.current === controller) {
        pageSummaryAbortRef.current = null;
      }
      if (mountedRef.current) {
        setIsPageSummaryLoading(false);
      }
    }
  };

  const handleRetryProcessing = async () => {
    if (!activeChapter || !activeChapter.ppt?.supabaseUrl) return;

    const nextPpt: ChapterPptMeta = {
      ...activeChapter.ppt,
      relevant_reading: null,
      is_reading_published: false,
    };

    await updateChapter(activeChapter.id, {
      ppt: nextPpt,
      quiz: [],
      extracted_text: null,
      content_status: 'idle',
      processing_stage: null,
      processing_progress: 0,
      processing_error: null,
    });

    await triggerAutoProcessing(
      {
        ...activeChapter,
        ppt: nextPpt,
        quiz: [],
        extracted_text: null,
        content_status: 'idle',
        processing_stage: null,
        processing_progress: 0,
        processing_error: null,
      },
      {
        fileUrl: activeChapter.ppt.supabaseUrl,
        fileName: activeChapter.ppt.originalName || 'document',
        mimeType: activeChapter.mime_type || 'application/pdf',
      }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChapterId || !activeChapter || isUploading) return;

    setIsUploading(true);
    setUploadProgress(10);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${course.id}/${fileName}`;

      setUploadProgress(30);

      const { error: uploadError } = await supabase.storage
        .from('course-materials')
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw new Error(
          'Failed to upload file to cloud storage. Please ensure the "course-materials" bucket exists and is accessible.'
        );
      }

      setUploadProgress(70);

      const {
        data: { publicUrl },
      } = supabase.storage.from('course-materials').getPublicUrl(filePath);

      const nextPpt: ChapterPptMeta = {
        supabaseUrl: publicUrl,
        originalName: file.name,
        storagePath: filePath,
        relevant_reading: null,
        is_reading_published: false,
        last_processed_at: null,
      };

      await updateChapter(activeChapterId, {
        file_uri: publicUrl,
        mime_type: file.type,
        ppt: nextPpt,
        quiz: [],
        extracted_text: null,
        content_status: 'idle',
        processing_stage: null,
        processing_progress: 0,
        processing_error: null,
      });

      setUploadProgress(100);

      void triggerAutoProcessing(
        {
          ...activeChapter,
          id: activeChapterId,
          file_uri: publicUrl,
          mime_type: file.type,
          ppt: nextPpt,
          quiz: [],
          extracted_text: null,
          content_status: 'queued',
          processing_stage: 'queued',
          processing_progress: 5,
          processing_error: null,
        },
        {
          fileUrl: publicUrl,
          fileName: file.name,
          mimeType: file.type,
        }
      );
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(error.message || 'Failed to upload file');
    } finally {
      if (mountedRef.current) {
        setIsUploading(false);
        setUploadProgress(0);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const renderStatusBadge = (chapter?: Chapter | null) => {
    const status = normalizeStatus(chapter);

    if (status === 'ready') {
      return (
        <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          Ready
        </span>
      );
    }

    if (status === 'failed') {
      return (
        <span className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          Failed
        </span>
      );
    }

    if (status === 'queued' || status === 'processing') {
      return (
        <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
          <Clock3 className="w-3 h-3" />
          {status === 'queued' ? 'Queued' : 'Processing'}
        </span>
      );
    }

    return (
      <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full text-xs font-bold uppercase tracking-wider">
        Idle
      </span>
    );
  };

  const renderProcessingPanel = (chapter: Chapter) => {
    const status = normalizeStatus(chapter);
    const progress = getProgress(chapter);
    const stageLabel = getStageLabel(chapter);

    if (!chapter.ppt?.supabaseUrl) return null;

    return (
      <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div
              className={`p-3 rounded-xl ${
                status === 'ready'
                  ? 'bg-emerald-100 dark:bg-emerald-900/30'
                  : status === 'failed'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-amber-100 dark:bg-amber-900/30'
              }`}
            >
              {status === 'ready' ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              ) : status === 'failed' ? (
                <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              ) : (
                <Loader2 className="w-6 h-6 text-amber-600 dark:text-amber-400 animate-spin" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  {chapter.ppt?.originalName || 'Uploaded document'}
                </p>
                {renderStatusBadge(chapter)}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Upload is automatic. After upload, the system will extract content, generate reading material,
                and prepare the chapter quiz for you.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {status === 'failed' && (
              <button
                onClick={handleRetryProcessing}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                <RotateCcw size={16} />
                Retry Processing
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              Upload Another
            </button>
          </div>
        </div>

        {(status === 'queued' || status === 'processing' || status === 'ready') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300 font-medium">
                {status === 'ready' ? 'Processing completed' : `Current stage: ${stageLabel}`}
              </span>
              <span className="text-slate-500 dark:text-slate-400">{progress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  status === 'ready' ? 'bg-emerald-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === 'failed' && chapter.processing_error && (
          <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-xl p-4">
            <p className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Processing failed</p>
            <p className="text-sm text-red-600 dark:text-red-300">{chapter.processing_error}</p>
          </div>
        )}
      </div>
    );
  };

  const renderReadingTab = () => {
    if (!activeChapter) return null;

    if (!activeChapter.ppt?.supabaseUrl) {
      return (
        <div className="text-center py-16 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No Material Uploaded Yet</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Upload a PDF or PPT in the Course Material tab first. Relevant Reading will be generated automatically.
          </p>
        </div>
      );
    }

    if (activeChapterStatus === 'queued' || activeChapterStatus === 'processing') {
      return (
        <div className="space-y-6">
          {renderProcessingPanel(activeChapter)}
          <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Reading Material is Being Prepared
            </h3>
            <p className="text-slate-500 dark:text-slate-400">
              Current stage: <span className="font-medium">{activeChapterStageLabel}</span> · {activeChapterProgress}%
            </p>
          </div>
        </div>
      );
    }

    if (activeChapterStatus === 'failed') {
      return (
        <div className="space-y-6">
          {renderProcessingPanel(activeChapter)}
          <div className="text-center py-12 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-800/30">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">Automatic Processing Failed</h3>
            <p className="text-red-600 dark:text-red-300 max-w-md mx-auto">
              {activeChapter.processing_error || 'The system could not finish processing this file.'}
            </p>
          </div>
        </div>
      );
    }

    if (!activeChapter.ppt?.relevant_reading) {
      return (
        <div className="text-center py-16 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No Reading Material Found</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            The file finished processing, but no supplementary reading was written back to the chapter.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
              Auto-generated Relevant Reading
            </h3>
            <div className="flex items-center gap-3">
              {activeChapter.ppt.is_reading_published ? (
                <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Published
                </span>
              ) : (
                <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <EyeOff className="w-3 h-3" />
                  Draft
                </span>
              )}
            </div>
          </div>

          {isEditingReading ? (
            <div className="space-y-4">
              <textarea
                value={editingReading}
                onChange={(e) => setEditingReading(e.target.value)}
                className="w-full h-96 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setIsEditingReading(false);
                    setEditingReading(activeChapter.ppt?.relevant_reading || '');
                  }}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const updatedPpt = {
                      ...(activeChapter.ppt || {}),
                      relevant_reading: editingReading,
                    };
                    await updateChapter(activeChapter.id, { ppt: updatedPpt });
                    setIsEditingReading(false);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Check size={16} /> Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="prose prose-slate dark:prose-invert max-w-none prose-sm bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-100 dark:border-slate-800">
                <Markdown>{activeChapter.ppt.relevant_reading || ''}</Markdown>
              </div>

              <div className="flex gap-3 justify-end pt-2 flex-wrap">
                <button
                  onClick={() => {
                    setEditingReading(activeChapter.ppt?.relevant_reading || '');
                    setIsEditingReading(true);
                  }}
                  className="px-4 py-2 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  <Edit2 size={16} /> Edit Content
                </button>

                <button
                  onClick={async () => {
                    const isPublished = !activeChapter.ppt?.is_reading_published;
                    const updatedPpt = {
                      ...(activeChapter.ppt || {}),
                      is_reading_published: isPublished,
                    };
                    await updateChapter(activeChapter.id, { ppt: updatedPpt });
                  }}
                  className={`px-4 py-2 rounded-xl font-medium transition-colors flex items-center gap-2 ${
                    activeChapter.ppt?.is_reading_published
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {activeChapter.ppt?.is_reading_published ? (
                    <>
                      <EyeOff size={16} /> Unpublish
                    </>
                  ) : (
                    <>
                      <Eye size={16} /> Publish to Students
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderQuizTab = () => {
    if (!activeChapter) return null;

    if (!activeChapter.ppt?.supabaseUrl) {
      return (
        <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <HelpCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No Quiz Available Yet</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Upload a chapter document first. The quiz will be generated automatically after processing.
          </p>
        </div>
      );
    }

    if (activeChapterStatus === 'queued' || activeChapterStatus === 'processing') {
      return (
        <div className="space-y-6">
          {renderProcessingPanel(activeChapter)}
          <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <Loader2 className="w-10 h-10 animate-spin text-violet-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Quiz is Being Generated
            </h3>
            <p className="text-slate-500 dark:text-slate-400">
              Current stage: <span className="font-medium">{activeChapterStageLabel}</span> · {activeChapterProgress}%
            </p>
          </div>
        </div>
      );
    }

    if (activeChapterStatus === 'failed') {
      return (
        <div className="space-y-6">
          {renderProcessingPanel(activeChapter)}
          <div className="text-center py-12 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-800/30">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">Quiz Generation Failed</h3>
            <p className="text-red-600 dark:text-red-300 max-w-md mx-auto">
              {activeChapter.processing_error || 'The system could not finish processing this file.'}
            </p>
          </div>
        </div>
      );
    }

    if (!activeChapter.quiz || activeChapter.quiz.length === 0) {
      return (
        <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <HelpCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No Quiz Generated</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Processing finished, but no quiz was written back to the chapter record.
          </p>
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
              {activeChapter.quiz.length} Questions
            </span>
            <span className="text-slate-400 text-sm">•</span>
            <span className="text-slate-500 text-sm italic">Auto Generated</span>
          </div>

          <button
            onClick={handleRetryProcessing}
            className="text-sm text-indigo-600 font-semibold hover:text-indigo-700 flex items-center gap-1"
          >
            <RotateCcw size={14} />
            Reprocess Material
          </button>
        </div>

        <QuizViewer questions={activeChapter.quiz} isTeacherView={true} />
      </div>
    );
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {isLeftSidebarOpen && (
        <div className="w-80 flex-shrink-0 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full transition-all">
          <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 ml-2">
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
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
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
                  className="w-full px-3 py-2 text-sm border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="submit"
                    className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingChapter(false)}
                    className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {chapters.length === 0 && !isCreatingChapter ? (
              <div className="text-center py-8 text-slate-500 text-sm">No chapters yet. Click + to add one.</div>
            ) : (
              chapters.map((chapter, idx) => {
                const status = normalizeStatus(chapter);

                return (
                  <button
                    key={chapter.id}
                    onClick={() => setActiveChapterId(chapter.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl group transition-all border ${
                      activeChapterId === chapter.id
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-100'
                        : 'hover:bg-slate-50 border-transparent text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 overflow-hidden min-w-0">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 mt-0.5 ${
                            activeChapterId === chapter.id
                              ? 'bg-indigo-200 text-indigo-800'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium truncate block">{chapter.title}</span>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {status === 'ready' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold uppercase tracking-wider">
                                Ready
                              </span>
                            )}
                            {(status === 'queued' || status === 'processing') && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold uppercase tracking-wider">
                                {getProgress(chapter)}%
                              </span>
                            )}
                            {status === 'failed' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-bold uppercase tracking-wider">
                                Failed
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <ChevronRight
                        className={`w-4 h-4 flex-shrink-0 mt-1 ${
                          activeChapterId === chapter.id
                            ? 'text-indigo-400'
                            : 'text-slate-300 opacity-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto pr-2 space-y-8">
        {!activeChapter ? (
          <div className="bg-white dark:bg-slate-800 p-12 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 text-center flex flex-col items-center justify-center h-full relative">
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

            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-full mb-4">
              <BookOpen className="w-12 h-12 text-indigo-300 dark:text-indigo-500" />
            </div>

            <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Select or Create a Chapter
            </h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-md mb-8">
              Organize your course into chapters. Uploading a chapter document will automatically trigger extraction,
              reading generation, and quiz generation.
            </p>

            <div className="w-full max-w-2xl bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-8 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Course Information</h3>
              </div>

              <div className="space-y-4 text-left">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Course Name</p>
                  <p className="text-slate-800 dark:text-slate-200 font-medium">{course.name}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Description</p>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {course.description || 'No description provided.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 relative">
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
                      className="flex-1 text-2xl font-semibold bg-slate-50 dark:bg-slate-900 border-b-2 border-indigo-500 outline-none px-1 text-slate-800 dark:text-white"
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
                  <div className="flex items-center gap-3 group flex-wrap">
                    <h2 className="text-2xl font-semibold text-slate-800 dark:text-white">{activeChapter.title}</h2>
                    {renderStatusBadge(activeChapter)}
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

            <div className="flex border-b border-slate-200 dark:border-slate-700 mb-8 overflow-x-auto">
              <button
                onClick={() => setActiveTab('material')}
                className={`px-6 py-3 font-medium text-sm transition-all border-b-2 whitespace-nowrap ${
                  activeTab === 'material'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Course Material
              </button>
              <button
                onClick={() => setActiveTab('reading')}
                className={`px-6 py-3 font-medium text-sm transition-all border-b-2 whitespace-nowrap ${
                  activeTab === 'reading'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Relevant Reading
              </button>
              <button
                onClick={() => setActiveTab('quiz')}
                className={`px-6 py-3 font-medium text-sm transition-all border-b-2 whitespace-nowrap ${
                  activeTab === 'quiz'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Chapter Quiz
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`px-6 py-3 font-medium text-sm transition-all border-b-2 whitespace-nowrap ${
                  activeTab === 'analytics'
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Analytics
              </button>
            </div>

            {activeTab === 'material' && (
              <div className="space-y-8">
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  onChange={handleFileUpload}
                />

                {!activeChapter.ppt?.supabaseUrl ? (
                  <div
                    className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-12 text-center hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                        <p className="text-slate-600 dark:text-slate-300 font-medium">
                          Uploading document... {uploadProgress}%
                        </p>
                        <div className="w-64 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-full">
                          <UploadCloud className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                          <p className="text-lg font-medium text-slate-700 dark:text-slate-300">
                            Upload Teaching Material (PDF or PPT)
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            After upload, extraction + reading + quiz generation will run automatically.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {renderProcessingPanel(activeChapter)}

                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-800 dark:text-slate-200">Document Preview</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {activeChapter.ppt?.originalName || 'Uploaded file'}
                          </p>
                        </div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                        >
                          Replace File
                        </button>
                      </div>

                      <div className="h-[70vh] bg-slate-50 dark:bg-slate-900/50">
                        {renderDocument(activeChapter)}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <Presentation className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        <h3 className="font-semibold text-slate-800 dark:text-slate-200">
                          Page Summary Preview
                        </h3>
                      </div>

                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        Enter a page number to generate an AI summary for that page. Both PDF and PPT/PPTX are supported, as long as the backend has completed the corresponding page-aware processing.
                      </p>

                      <div className="flex items-center gap-3 mb-4">
                        <input
                          type="number"
                          min={1}
                          value={pageNumberInput}
                          onChange={(e) => setPageNumberInput(e.target.value)}
                          className="w-24 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          disabled={isPageSummaryLoading || activeChapterStatus !== 'ready'}
                          placeholder="Page"
                        />
                        <button
                          type="button"
                          onClick={handleGeneratePageSummary}
                          disabled={isPageSummaryLoading || activeChapterStatus !== 'ready'}
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isPageSummaryLoading ? 'Generating...' : 'Generate Summary'}
                        </button>
                      </div>

                      {isPageSummaryLoading && (
                        <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 mb-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Generating summary...</span>
                        </div>
                      )}

                      {pageSummaryError && (
                        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-lg p-3 mb-4">
                          {pageSummaryError}
                        </div>
                      )}

                      {pageSummary !== null && !pageSummaryError && (
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-lg p-4">
                          <div className="prose prose-sm max-w-none dark:prose-invert prose-indigo">
                            <Markdown>{pageSummary}</Markdown>
                          </div>
                        </div>
                      )}

                      {activeChapterStatus !== 'ready' && (
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          {activeChapterStatus === 'failed'
                            ? 'This chapter failed processing, so a page summary cannot be generated.'
                            : `This chapter is still being processed (${activeChapterStageLabel}, ${activeChapterProgress}%). Page summaries will be available once processing is complete.`}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'reading' && renderReadingTab()}
            {activeTab === 'quiz' && renderQuizTab()}

            {activeTab === 'analytics' && (
              <div className="space-y-8">
                {isLoadingSubmissions ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin mb-4" />
                    <p>Loading analytics data...</p>
                  </div>
                ) : !analytics ? (
                  <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                    <div className="bg-white dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <BarChart3 className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">No Submissions Yet</h3>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                      Once students complete the quiz for this chapter, you&apos;ll see their performance metrics here.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">
                          Total Completions
                        </p>
                        <div className="flex items-end gap-2">
                          <span className="text-4xl font-black text-slate-800 dark:text-slate-200">
                            {analytics.totalCompletions}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 text-sm mb-1">attempts</span>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">
                          Average Score
                        </p>
                        <div className="flex items-end gap-2">
                          <span className="text-4xl font-black text-indigo-600 dark:text-indigo-400">
                            {analytics.avgScore}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 text-sm mb-1">
                            / {activeChapter.quiz.length}
                          </span>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1 uppercase tracking-wider">
                          Unique Students
                        </p>
                        <div className="flex items-end gap-2">
                          <span className="text-4xl font-black text-emerald-600 dark:text-emerald-400">
                            {analytics.totalStudents}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 text-sm mb-1">enrolled</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-slate-50 dark:border-slate-700/50 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
                        <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                          <AlertCircle className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                          Question Performance
                        </h3>
                        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                          Accuracy Rate
                        </span>
                      </div>

                      <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                        {analytics.questionStats.map((stat: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                          >
                            <div className="flex gap-4 items-start max-w-[70%]">
                              <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {idx + 1}
                              </span>
                              <p className="text-slate-700 dark:text-slate-300 font-medium line-clamp-2">
                                {stat.question}
                              </p>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="w-32 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className={`h-full transition-all duration-500 ${
                                    stat.isLowAccuracy ? 'bg-red-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${stat.accuracy}%` }}
                                />
                              </div>
                              <span
                                className={`font-black text-lg w-16 text-right ${
                                  stat.isLowAccuracy
                                    ? 'text-red-500 dark:text-red-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                {stat.accuracy}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                      <div className="p-6 border-b border-slate-50 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-900/50">
                        <h3 className="font-bold text-slate-800 dark:text-slate-200">Recent Submissions</h3>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-50 dark:border-slate-700/50">
                              <th className="px-6 py-4">Student</th>
                              <th className="px-6 py-4">Score</th>
                              <th className="px-6 py-4">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                            {submissions.slice(0, 5).map((sub) => (
                              <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                <td className="px-6 py-4 font-semibold text-slate-700 dark:text-slate-300">
                                  {sub.student_name}
                                </td>
                                <td className="px-6 py-4">
                                  <span
                                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                                      sub.score >= activeChapter.quiz.length / 2
                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                    }`}
                                  >
                                    {sub.score} / {activeChapter.quiz.length}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-sm">
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
        )}
      </div>
    </div>
  );
}