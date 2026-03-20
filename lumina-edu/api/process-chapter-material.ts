import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type ChapterPptMeta = {
  supabaseUrl?: string;
  originalName?: string;
  storagePath?: string;
  relevant_reading?: string | null;
  is_reading_published?: boolean;
  last_processed_at?: string | null;
};

type ChapterRow = {
  id: string;
  title: string;
  ppt: ChapterPptMeta | null;
  quiz: any[] | null;
  extracted_text: string | null;
  content_status: string | null;
  processing_stage: string | null;
  processing_progress: number | null;
  processing_error: string | null;
};

type ProcessPayload = {
  chapterId: string;
  chapterTitle?: string;
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
};

type QwenDocParsingStrategy = 'auto' | 'text_only' | 'text_and_images';

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getQwenDocConfig() {
  const apiKey =
    process.env.QWEN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.LLM_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error(
      'Missing QWEN_API_KEY (or DASHSCOPE_API_KEY / LLM_API_KEY).'
    );
  }

  return {
    apiKey,
    endpoint:
      process.env.QWEN_DASHSCOPE_BASE_URL ||
      'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    model: process.env.QWEN_DOC_MODEL || 'qwen-doc-turbo',
  };
}

function getQwenChatConfig() {
  const apiKey =
    process.env.QWEN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.LLM_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error(
      'Missing QWEN_API_KEY (or DASHSCOPE_API_KEY / LLM_API_KEY).'
    );
  }

  return {
    apiKey,
    baseUrl:
      process.env.QWEN_BASE_URL?.replace(/\/$/, '') ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: process.env.LLM_MODEL || 'qwen-plus',
  };
}

function truncate(text: string, maxLen = 1200) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...(truncated)` : text;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function normalizeMimeType(fileName: string, mimeType = '') {
  const lower = fileName.toLowerCase();

  if (mimeType) return mimeType;
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.pptx'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md')) return 'text/markdown';

  return 'application/octet-stream';
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 120000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = (await req.json()) as ProcessPayload;

    if (!body.chapterId || !body.fileUrl) {
      return json({ ok: false, error: 'Missing chapterId or fileUrl.' }, 400);
    }

    console.log('[process-chapter-material] start', {
      chapterId: body.chapterId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileUrl: body.fileUrl,
    });

    const existingChapter = await getChapter(supabase, body.chapterId);

    if (!existingChapter) {
      return json({ ok: false, error: 'Chapter not found.' }, 404);
    }

    const isBusy =
      existingChapter.content_status === 'queued' ||
      existingChapter.content_status === 'processing';

    if (isBusy) {
      console.log('[process-chapter-material] duplicate request blocked', {
        chapterId: body.chapterId,
        content_status: existingChapter.content_status,
        processing_stage: existingChapter.processing_stage,
        processing_progress: existingChapter.processing_progress,
      });

      return json({
        ok: true,
        skipped: true,
        message: 'This chapter is already being processed.',
        content_status: existingChapter.content_status,
        processing_stage: existingChapter.processing_stage,
        processing_progress: existingChapter.processing_progress,
      });
    }

    await updateChapterProgress(supabase, body.chapterId, {
      content_status: 'queued',
      processing_stage: 'queued',
      processing_progress: 5,
      processing_error: null,
    });

    try {
      await processChapterMaterial(supabase, body);
      return json({ ok: true });
    } catch (err) {
      console.error('[process-chapter-material] processing error:', err);

      await failChapter(
        supabase,
        body.chapterId,
        err instanceof Error ? err.message : 'Unknown processing error'
      );

      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown processing error',
        },
        500
      );
    }
  } catch (err) {
    console.error('[process-chapter-material] handler error:', err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid request',
      },
      500
    );
  }
}

async function processChapterMaterial(
  supabase: SupabaseClient,
  payload: ProcessPayload
) {
  const { chapterId, fileUrl, fileName = 'document', mimeType = '' } = payload;

  const chapter = await getChapter(supabase, chapterId);
  if (!chapter) {
    throw new Error('Chapter not found.');
  }

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'processing',
    processing_stage: 'extracting_text',
    processing_progress: 15,
    processing_error: null,
  });

  const extractedText = await extractTextFromFileWithQwen({
    fileUrl,
    fileName,
    mimeType,
  });

  const normalizedText = normalizeExtractedText(extractedText);

  if (!normalizedText || normalizedText.length < 80) {
    throw new Error(
      'Qwen document parsing returned too little content. Please try another file or verify that the uploaded document is readable.'
    );
  }

  await updateChapterProgress(supabase, chapterId, {
    extracted_text: normalizedText,
    content_status: 'processing',
    processing_stage: 'chunking',
    processing_progress: 45,
    processing_error: null,
  });

  const chunks = chunkText(normalizedText, 1800, 200);
  const condensedContext = buildCondensedContext(chunks);

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'processing',
    processing_stage: 'generating_reading',
    processing_progress: 68,
    processing_error: null,
  });

  const reading = await generateRelevantReading({
    chapterTitle: chapter.title,
    context: condensedContext,
  });

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'processing',
    processing_stage: 'generating_quiz',
    processing_progress: 86,
    processing_error: null,
  });

  const quiz = await generateQuiz({
    chapterTitle: chapter.title,
    context: condensedContext,
  });

  const { error: deleteQuizErr } = await supabase
    .from('quiz_submissions')
    .delete()
    .eq('chapter_id', chapterId);

  if (deleteQuizErr) {
    throw new Error(
      deleteQuizErr.message || 'Failed to clear old quiz submissions.'
    );
  }

  const nextPpt: ChapterPptMeta = {
    ...(chapter.ppt || {}),
    relevant_reading: reading,
    is_reading_published: false,
    last_processed_at: new Date().toISOString(),
  };

  await updateChapterProgress(supabase, chapterId, {
    ppt: nextPpt,
    quiz,
    content_status: 'processing',
    processing_stage: 'finalizing',
    processing_progress: 96,
    processing_error: null,
  });

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'ready',
    processing_stage: 'completed',
    processing_progress: 100,
    processing_error: null,
  });
}

async function getChapter(
  supabase: SupabaseClient,
  chapterId: string
): Promise<ChapterRow | null> {
  const { data, error } = await supabase
    .from('chapters')
    .select('*')
    .eq('id', chapterId)
    .single();

  if (error) {
    console.error('[getChapter] error:', error);
    return null;
  }

  return data as ChapterRow;
}

async function updateChapterProgress(
  supabase: SupabaseClient,
  chapterId: string,
  updates: Record<string, any>
) {
  const { error } = await supabase
    .from('chapters')
    .update(updates)
    .eq('id', chapterId);

  if (error) {
    console.error('[updateChapterProgress] error:', error);
    throw new Error(error.message || 'Failed to update chapter progress.');
  }
}

async function failChapter(
  supabase: SupabaseClient,
  chapterId: string,
  errorMessage: string
) {
  try {
    await supabase
      .from('chapters')
      .update({
        content_status: 'failed',
        processing_stage: 'failed',
        processing_progress: 0,
        processing_error: errorMessage,
      })
      .eq('id', chapterId);
  } catch (err) {
    console.error('[failChapter] error:', err);
  }
}

async function extractTextFromFileWithQwen(args: {
  fileUrl: string;
  fileName: string;
  mimeType?: string;
}): Promise<string> {
  const { fileUrl, fileName, mimeType = '' } = args;

  if (!isHttpUrl(fileUrl)) {
    throw new Error('fileUrl must be a public http(s) URL.');
  }

  const resolvedMimeType = normalizeMimeType(fileName, mimeType);
  const prompt = buildDocExtractionPrompt({
    fileName,
    mimeType: resolvedMimeType,
  });

  console.log('[qwen-doc] request', {
    fileName,
    mimeType: resolvedMimeType,
    fileUrl,
  });

  let lastError: unknown = null;

  const strategies: QwenDocParsingStrategy[] = ['auto', 'text_and_images', 'text_only'];

  for (const strategy of strategies) {
    try {
      const text = await callQwenDocumentUrl({
        fileUrl,
        mimeType: resolvedMimeType,
        prompt,
        parsingStrategy: strategy,
      });

      const normalized = normalizeExtractedText(text);
      console.log('[qwen-doc] extracted length:', normalized.length, 'strategy=', strategy);

      if (normalized.length >= 80) {
        return normalized;
      }

      lastError = new Error(
        `Qwen document parsing returned too little content with strategy "${strategy}".`
      );
    } catch (err) {
      lastError = err;
      console.error('[qwen-doc] strategy failed:', strategy, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Qwen document parsing failed.');
}

function buildDocExtractionPrompt(args: {
  fileName: string;
  mimeType?: string;
}) {
  const { fileName, mimeType = '' } = args;

  return `
You are extracting the full readable teaching content from a course document.

Goal:
Return the document content in clean Markdown for downstream educational processing.

Strict requirements:
1. Do NOT summarize.
2. Do NOT explain.
3. Do NOT answer questions about the file.
4. Preserve as much original content as possible.
5. Keep headings, bullet points, numbered lists, formulas, equations, captions, and emphasized terms.
6. If a table exists, convert it into a readable Markdown table when possible; otherwise convert it into clearly labeled rows and columns.
7. If a figure, diagram, chart, or image contains meaningful educational information, preserve that information as concise descriptive notes near the relevant section.
8. If page or slide boundaries are obvious, add:
   --- Page/Slide Break ---
9. Ignore clearly unreadable fragments instead of hallucinating.
10. Output Markdown only.

File name: ${fileName}
MIME type: ${mimeType || 'unknown'}
`.trim();
}

async function callQwenDocumentUrl(args: {
  fileUrl: string;
  mimeType: string;
  prompt: string;
  parsingStrategy: QwenDocParsingStrategy;
}): Promise<string> {
  const { fileUrl, mimeType, prompt, parsingStrategy } = args;
  const { apiKey, endpoint, model } = getQwenDocConfig();

  const body = {
    model,
    input: {
      messages: [
        {
          role: 'system',
          content: 'You are a careful document parsing assistant.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'doc_url',
              doc_url: [fileUrl],
              file_parsing_strategy: parsingStrategy,
              mime_type: mimeType,
            },
          ],
        },
      ],
    },
    parameters: {
      result_format: 'message',
      temperature: 0.1,
    },
  };

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    120000
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Qwen document request failed: ${res.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Qwen document returned non-JSON response: ${truncate(raw)}`);
  }

  const statusCode = Number(data?.status_code ?? 200);
  const errorCode = data?.code;
  const errorMessage = data?.message;

  if (statusCode !== 200) {
    throw new Error(
      `Qwen document parse failed: status_code=${statusCode}, code=${String(
        errorCode || ''
      )}, message=${String(errorMessage || '')}`
    );
  }

  const content = extractQwenText(data);

  if (!content) {
    throw new Error(`Qwen document parsing returned empty content. raw=${truncate(raw)}`);
  }

  return content;
}

async function generateRelevantReading(args: {
  chapterTitle: string;
  context: string;
}): Promise<string> {
  const { chapterTitle, context } = args;

  const prompt = `
You are helping a university teacher create supplementary reading material for one chapter.

Task:
Write high-quality "Relevant Reading" in Markdown for students.

Requirements:
1. Base it on the chapter material below.
2. Include:
   - a short overview
   - 3 to 5 key concepts with brief explanations
   - 2 to 3 real-world examples / case studies
   - a short "Why this matters" section
   - a short "Questions to think about" section
3. Make it clear, educational, and student-friendly.
4. Do NOT say "based on the provided text" or mention being an AI.
5. Output Markdown only.

Chapter title:
${chapterTitle}

Chapter material:
${context}
`.trim();

  return await callQwenChatText(prompt, 0.4);
}

async function generateQuiz(args: {
  chapterTitle: string;
  context: string;
}): Promise<any[]> {
  const { chapterTitle, context } = args;

  const prompt = `
You are generating a chapter quiz for students.

Task:
Create exactly 10 multiple-choice questions based only on the chapter material.

Output requirements:
- Return ONLY valid JSON.
- Return an array of 10 objects.
- Each object must have:
  - "question": string
  - "options": string[]   // exactly 4 options
  - "correctAnswerIndex": number   // 0 to 3
  - "explanation": string

Quality requirements:
- Questions should test understanding, not trivial wording.
- Distractors should be plausible.
- Keep explanations concise.
- Do not invent facts that are not supported by the chapter material.

Chapter title:
${chapterTitle}

Chapter material:
${context}
`.trim();

  const raw = await callQwenChatText(prompt, 0.2);
  const parsed = parseQuizJson(raw);

  if (!Array.isArray(parsed) || parsed.length !== 10) {
    throw new Error('Quiz JSON parsing failed or returned wrong number of questions.');
  }

  const sanitized = parsed.map((q: any, idx: number) => {
    const options = Array.isArray(q?.options)
      ? q.options.map((x: any) => String(x))
      : [];
    const correctAnswerIndex = Number(q?.correctAnswerIndex);

    if (!q?.question || options.length !== 4 || Number.isNaN(correctAnswerIndex)) {
      throw new Error(`Invalid quiz item at index ${idx}`);
    }

    return {
      question: String(q.question),
      options,
      correctAnswerIndex: Math.min(3, Math.max(0, correctAnswerIndex)),
      explanation: String(q.explanation || ''),
    };
  });

  return sanitized;
}

function parseQuizJson(raw: string): any[] {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.quiz)) return parsed.quiz;
  } catch {}

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const sliced = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }

  throw new Error(`Could not parse quiz JSON from model output: ${truncate(raw)}`);
}

async function callQwenChatText(prompt: string, temperature = 0.3): Promise<string> {
  const { apiKey, baseUrl, model } = getQwenChatConfig();
  const endpoint = `${baseUrl}/chat/completions`;

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {
            role: 'system',
            content:
              'You are a precise educational assistant. Follow the output format exactly.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    },
    120000
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Qwen chat request failed: ${res.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Qwen chat returned non-JSON response: ${truncate(raw)}`);
  }

  const content = extractQwenText(data);

  if (!content) {
    throw new Error(`Qwen chat returned empty content. raw=${truncate(raw)}`);
  }

  return content;
}

function extractQwenText(data: any): string {
  const content = data?.output?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();

    if (text) return text;
  }

  if (typeof data?.output?.text === 'string') {
    return data.output.text.trim();
  }

  return '';
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00A0]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text: string, maxLen = 1800, overlap = 200): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const lineBreak = text.lastIndexOf('\n', end);
      const sentenceBreak = Math.max(
        text.lastIndexOf('. ', end),
        text.lastIndexOf('。', end),
        text.lastIndexOf('! ', end),
        text.lastIndexOf('? ', end)
      );

      const betterEnd = [paragraphBreak, lineBreak, sentenceBreak]
        .filter((idx) => idx > start + Math.floor(maxLen * 0.55))
        .sort((a, b) => b - a)[0];

      if (betterEnd) end = betterEnd + 1;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function buildCondensedContext(chunks: string[]): string {
  if (chunks.length <= 8) {
    return chunks.map((c, i) => `[Chunk ${i + 1}]\n${c}`).join('\n\n');
  }

  const selected: string[] = [];
  const head = chunks.slice(0, 3);
  const middleStart = Math.max(3, Math.floor(chunks.length / 2) - 1);
  const middle = chunks.slice(middleStart, middleStart + 2);
  const tail = chunks.slice(-3);

  [...head, ...middle, ...tail].forEach((chunk) => {
    if (!selected.includes(chunk)) selected.push(chunk);
  });

  return selected.map((c, i) => `[Chunk ${i + 1}]\n${c}`).join('\n\n');
}