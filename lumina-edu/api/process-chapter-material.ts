import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

const NO_READABLE_TEXT_PLACEHOLDER = '[No readable text extracted for this page.]';

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

type PageSection = {
  page: number;
  content: string;
};

type PageValidationResult = {
  ok: boolean;
  reason?: string;
  pageCount: number;
};

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

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY.');
  }

  return {
    apiKey,
    baseUrl:
      process.env.GEMINI_BASE_URL?.replace(/\/$/, '') ||
      'https://generativelanguage.googleapis.com/v1beta',
    pdfModel: process.env.GEMINI_PDF_MODEL || 'gemini-2.5-flash',
    thinkingBudget: envInt('GEMINI_THINKING_BUDGET', 1024, -1, 24576),
    maxOutputTokens: envInt('GEMINI_PDF_MAX_OUTPUT_TOKENS', 16384, 1024, 65536),
  };
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

function envInt(name: string, fallback: number, min?: number, max?: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  let value = Math.floor(raw);
  if (typeof min === 'number') value = Math.max(min, value);
  if (typeof max === 'number') value = Math.min(max, value);
  return value;
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

function isPdfFile(fileName: string, mimeType = '') {
  return normalizeMimeType(fileName, mimeType) === 'application/pdf';
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(
  fn: () => Promise<T>,
  options?: {
    retries?: number;
    baseDelayMs?: number;
  }
): Promise<T> {
  const retries = options?.retries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 800;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;

      const delay =
        baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
      await sleep(delay);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Retry failed.');
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

  const resolvedMimeType = normalizeMimeType(fileName, mimeType);

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'processing',
    processing_stage: 'extracting_text',
    processing_progress: 15,
    processing_error: null,
  });

  let pageNumberedText = '';
  let overallContextText = '';

  if (isPdfFile(fileName, resolvedMimeType)) {
    const pdfBytes = await downloadBinaryFile(fileUrl);

    const extracted = await extractPdfWithGeminiPageMarkers({
      pdfBytes,
      fileName,
    });

    pageNumberedText = extracted.pageNumberedText;
    overallContextText = extracted.plainText;
  } else {
    const wholeDocText = await extractTextFromNonPdfWithQwen({
      fileUrl,
      fileName,
      mimeType: resolvedMimeType,
    });

    const normalizedWholeDocText = normalizeExtractedText(wholeDocText);
    pageNumberedText = addPageNumbersToExtractedText(normalizedWholeDocText);
    overallContextText = stripPageLabelsFromExtractedText(pageNumberedText);
  }

  const pageValidation = validatePageNumberedText(pageNumberedText);

  if (!pageValidation.ok) {
    throw new Error(
      `Page-aware extraction failed validation: ${pageValidation.reason || 'unknown reason'}`
    );
  }

  if (!pageNumberedText || pageNumberedText.length < 80) {
    throw new Error(
      'Document parsing returned too little content. Please try another file or verify that the uploaded document is readable.'
    );
  }

  if (!overallContextText || overallContextText.length < 80) {
    overallContextText = stripPageLabelsFromExtractedText(pageNumberedText);
  }

  await updateChapterProgress(supabase, chapterId, {
    extracted_text: pageNumberedText,
    content_status: 'processing',
    processing_stage: 'chunking',
    processing_progress: 45,
    processing_error: null,
  });

  const chunks = chunkText(overallContextText, 1800, 200);
  const condensedContext = buildCondensedContext(chunks);

  const pages = extractPagesFromText(pageNumberedText);
  const pageAwareContext = buildPageAwareContext(pages);

  await updateChapterProgress(supabase, chapterId, {
    content_status: 'processing',
    processing_stage: 'generating_reading',
    processing_progress: 68,
    processing_error: null,
  });

  const reading = await generateRelevantReading({
    chapterTitle: chapter.title,
    context: condensedContext,
    pageAwareContext,
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

async function extractPdfWithGeminiPageMarkers(args: {
  pdfBytes: Uint8Array;
  fileName: string;
}): Promise<{ pageNumberedText: string; plainText: string }> {
  const { pdfBytes, fileName } = args;
  const { pdfModel, thinkingBudget, maxOutputTokens } = getGeminiConfig();

  const prompt = buildGeminiPdfPageAwarePrompt({ fileName });

  const raw = await withRetries(
    () =>
      callGeminiPdfInlineText({
        model: pdfModel,
        prompt,
        pdfBytes,
        thinkingBudget,
        maxOutputTokens,
        timeoutMs: 180000,
      }),
    { retries: 2, baseDelayMs: 1200 }
  );

  const normalized = normalizeExtractedText(raw);
  const pageNumberedText = addPageNumbersToExtractedText(normalized);
  const plainText = stripPageLabelsFromExtractedText(pageNumberedText);

  console.log('[gemini-pdf-pageaware] model=', pdfModel, 'len=', normalized.length);

  return {
    pageNumberedText,
    plainText,
  };
}

function buildGeminiPdfPageAwarePrompt(args: { fileName: string }) {
  const { fileName } = args;

  return `
You are extracting the full readable teaching content from a course PDF.

Goal:
Return the PDF content in clean Markdown, while preserving page boundaries explicitly.

This is critical:
- Start EACH page with an exact standalone marker in this format:
  [[PAGE_1]]
  [[PAGE_2]]
  [[PAGE_3]]
  ...
- Use one marker for every page in order.
- Do NOT skip page numbers.
- Do NOT merge multiple pages into one page marker.
- If a page has little readable text, still include its page marker and any readable title, labels, or notes from that page.

Strict requirements:
1. Do NOT summarize.
2. Do NOT explain.
3. Do NOT answer questions about the file.
4. Preserve as much original content as possible.
5. Keep headings, bullet points, numbered lists, formulas, equations, captions, and emphasized terms.
6. If a table exists, convert it into a readable Markdown table when possible; otherwise convert it into clearly labeled rows and columns.
7. If a figure, diagram, chart, or image contains meaningful educational information, preserve that information as concise descriptive notes near the relevant section.
8. Preserve the reading order within each page as much as possible.
9. Ignore clearly unreadable fragments instead of hallucinating.
10. Output Markdown only.
11. Do not wrap the whole output in triple backticks.
12. Do not add any introduction or conclusion outside the page markers.

PDF file name: ${fileName}
`.trim();
}

async function callGeminiPdfInlineText(args: {
  model: string;
  prompt: string;
  pdfBytes: Uint8Array;
  thinkingBudget: number;
  maxOutputTokens: number;
  timeoutMs?: number;
}): Promise<string> {
  const {
    model,
    prompt,
    pdfBytes,
    thinkingBudget,
    maxOutputTokens,
    timeoutMs = 180000,
  } = args;

  const { apiKey, baseUrl } = getGeminiConfig();
  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: Buffer.from(pdfBytes).toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget,
      },
    },
  };

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Gemini request failed: ${res.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned non-JSON response: ${truncate(raw)}`);
  }

  const text = extractGeminiText(data);

  if (!text) {
    throw new Error(`Gemini returned empty content. raw=${truncate(raw)}`);
  }

  return text;
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (Array.isArray(parts)) {
    const text = parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();

    if (text) return text;
  }

  if (typeof data?.text === 'string' && data.text.trim()) {
    return data.text.trim();
  }

  return '';
}

async function extractTextFromNonPdfWithQwen(args: {
  fileUrl: string;
  fileName: string;
  mimeType?: string;
}): Promise<string> {
  const { fileUrl, fileName, mimeType = '' } = args;

  if (!isHttpUrl(fileUrl)) {
    throw new Error('fileUrl must be a public http(s) URL.');
  }

  const resolvedMimeType = normalizeMimeType(fileName, mimeType);
  const prompt = buildWholeDocExtractionPrompt({
    fileName,
    mimeType: resolvedMimeType,
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
      console.log('[qwen-doc non-pdf] extracted length:', normalized.length, 'strategy=', strategy);

      if (normalized.length >= 80) {
        return normalized;
      }

      lastError = new Error(
        `Qwen non-PDF parsing returned too little content with strategy "${strategy}".`
      );
    } catch (err) {
      lastError = err;
      console.error('[qwen-doc non-pdf] strategy failed:', strategy, err);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Qwen non-PDF parsing failed.');
}

function buildWholeDocExtractionPrompt(args: {
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
8. Preserve the original reading order as much as possible.
9. Ignore clearly unreadable fragments instead of hallucinating.
10. Output Markdown only.
11. Do not wrap the whole output in triple backticks.

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
  pageAwareContext: string;
}): Promise<string> {
  const { chapterTitle, context, pageAwareContext } = args;

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
3. After the main structure, add a final section titled:
   ## Page-by-Page Guide
4. In that final section, use exact subheadings:
   ### Page 1
   ### Page 2
   ### Page 3
   ...
   matching the page numbers provided in the page map.
5. Under each page heading, write 2 to 5 concise bullet points describing the knowledge on that page only.
6. Do NOT skip page numbers. Do NOT merge multiple pages into one heading.
7. If a page is mostly a title page, agenda page, transition page, recap page, or contains almost no readable text, say that briefly and accurately.
8. Make it clear, educational, and student-friendly.
9. Do NOT say "based on the provided text" or mention being an AI.
10. Output Markdown only.
11. If the page map is incomplete or missing a page, do not invent missing page content.
12. Only describe pages that are explicitly present in the page map.

Chapter title:
${chapterTitle}

Chapter material:
${context}

Page map:
${pageAwareContext}
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
  const content =
    data?.output?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.message?.content;

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

function stripOuterMarkdownFence(text: string): string {
  const trimmed = text.trim();

  if (
    /^```(?:markdown|md)?\s*/i.test(trimmed) &&
    /\s*```$/.test(trimmed)
  ) {
    return trimmed
      .replace(/^```(?:markdown|md)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  return trimmed;
}

function normalizeExtractedText(text: string): string {
  return stripOuterMarkdownFence(text)
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00A0]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function addPageNumbersToExtractedText(text: string): string {
  const normalized = normalizeExtractedText(text);

  const explicitPages = extractExplicitPageMarkers(normalized);
  if (explicitPages.length > 0) {
    return explicitPages
      .map((section, idx) => {
        const content = section.content.trim() || NO_READABLE_TEXT_PLACEHOLDER;
        return `[Page ${idx + 1}]\n${content}`;
      })
      .join('\n\n')
      .trim();
  }

  const canonical = normalized
    .replace(/^\s*\[\[\s*PAGE_BREAK\s*\]\]\s*$/gim, '[[PAGE_BREAK]]')
    .replace(/^\s*---\s*Page\/Slide Break\s*---\s*$/gim, '[[PAGE_BREAK]]')
    .replace(/^\s*---\s*Page Break\s*---\s*$/gim, '[[PAGE_BREAK]]')
    .replace(/^\s*---\s*Slide Break\s*---\s*$/gim, '[[PAGE_BREAK]]')
    .replace(/(?:\n?\s*\[\[PAGE_BREAK\]\]\s*\n?){2,}/g, '\n[[PAGE_BREAK]]\n')
    .trim();

  const parts = canonical
    .split(/\n?\s*\[\[PAGE_BREAK\]\]\s*\n?/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return `[Page 1]\n${normalized || NO_READABLE_TEXT_PLACEHOLDER}`;
  }

  return parts
    .map((part, idx) => `[Page ${idx + 1}]\n${part || NO_READABLE_TEXT_PLACEHOLDER}`)
    .join('\n\n')
    .trim();
}

function extractExplicitPageMarkers(text: string): PageSection[] {
  const regex = /^\[\[PAGE_(\d+)\]\]\s*$/gim;
  const matches = [...text.matchAll(regex)];

  if (!matches.length) return [];

  const pages: PageSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? text.length;

    pages.push({
      page: i + 1,
      content: text.slice(start, end).trim(),
    });
  }

  return pages;
}

function extractPagesFromText(text: string): PageSection[] {
  const regex = /^\[Page\s+(\d+)\]\s*$/gim;
  const matches = [...text.matchAll(regex)];

  if (!matches.length) {
    const trimmed = text.trim();
    return trimmed ? [{ page: 1, content: trimmed }] : [];
  }

  const pages: PageSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? text.length;
    const content = text.slice(start, end).trim();

    pages.push({
      page: i + 1,
      content: content || NO_READABLE_TEXT_PLACEHOLDER,
    });
  }

  return pages;
}

function effectivePageContentLength(text: string): number {
  const cleaned = text
    .replace(NO_READABLE_TEXT_PLACEHOLDER, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length;
}

function validatePageNumberedText(pageNumberedText: string): PageValidationResult {
  const pages = extractPagesFromText(pageNumberedText);

  if (!pages.length) {
    return { ok: false, reason: 'No [Page n] sections found.', pageCount: 0 };
  }

  for (let i = 0; i < pages.length; i++) {
    const expected = i + 1;
    if (pages[i].page !== expected) {
      return {
        ok: false,
        reason: `Non-sequential page numbering detected. Expected Page ${expected}, got Page ${pages[i].page}.`,
        pageCount: pages.length,
      };
    }
  }

  const lengths = pages.map((p) => effectivePageContentLength(p.content));
  const total = lengths.reduce((sum, len) => sum + len, 0);
  const meaningfulPages = lengths.filter((len) => len >= 8).length;

  if (total < 80) {
    return {
      ok: false,
      reason: 'Extracted content is too short after pagination.',
      pageCount: pages.length,
    };
  }

  if (meaningfulPages < 1) {
    return {
      ok: false,
      reason: 'No page contains readable content.',
      pageCount: pages.length,
    };
  }

  return {
    ok: true,
    pageCount: pages.length,
  };
}

function stripPageLabelsFromExtractedText(text: string): string {
  return text
    .replace(/^\[Page\s+\d+\]\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactPageContent(text: string, maxLen = 320): string {
  const cleaned = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= maxLen) return cleaned;
  if (maxLen <= 100) return cleaned.slice(0, maxLen).trim();

  const headLen = Math.max(60, Math.floor(maxLen * 0.72));
  const tailLen = Math.max(24, Math.floor(maxLen * 0.18));

  return [
    cleaned.slice(0, headLen).trim(),
    '...(omitted)...',
    cleaned.slice(-tailLen).trim(),
  ].join('\n');
}

function buildPageAwareContext(
  pages: PageSection[],
  totalMaxLen = 14000
): string {
  if (!pages.length) return '';

  const preferredPerPage =
    pages.length <= 8
      ? 700
      : pages.length <= 15
      ? 420
      : pages.length <= 30
      ? 260
      : 180;

  const budgetPerPage = Math.max(
    120,
    Math.floor(totalMaxLen / Math.max(1, pages.length)) - 24
  );

  let perPageMax = Math.min(preferredPerPage, budgetPerPage);

  let blocks = pages.map(
    (page) =>
      `[Page ${page.page}]\n${compactPageContent(page.content, perPageMax)}`
  );

  let joined = blocks.join('\n\n');

  if (joined.length <= totalMaxLen) return joined;

  perPageMax = Math.max(
    80,
    Math.floor(totalMaxLen / Math.max(1, pages.length)) - 24
  );

  blocks = pages.map(
    (page) =>
      `[Page ${page.page}]\n${compactPageContent(page.content, perPageMax)}`
  );
  joined = blocks.join('\n\n');

  return joined.length <= totalMaxLen
    ? joined
    : joined.slice(0, totalMaxLen).trim();
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

async function downloadBinaryFile(fileUrl: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(fileUrl, {}, 120000);

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(`Failed to download file: ${res.status} ${truncate(raw)}`);
  }

  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}