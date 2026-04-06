// export { config } from '../../page-summary';
// export { default } from '../../page-summary';

import JSZip from 'jszip';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

type ChapterPptMeta = {
  supabaseUrl?: string;
  originalName?: string;
  storagePath?: string;
};

type ChapterRow = {
  id: string;
  title: string;
  mime_type?: string | null;
  ppt: ChapterPptMeta | null;
};

type SummaryRequestBody = {
  pageNumber?: number;
};

type AiProvider = 'qwen' | 'gemini';

const STORAGE_BUCKET = 'course-materials';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
    model: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  };
}

function hasGeminiApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getQwenConfig() {
  const apiKey =
    process.env.QWEN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.LLM_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error('Missing QWEN_API_KEY (or DASHSCOPE_API_KEY / LLM_API_KEY).');
  }

  return {
    apiKey,
    baseUrl:
      process.env.QWEN_BASE_URL?.replace(/\/$/, '') ||
      process.env.LLM_BASE_URL?.replace(/\/$/, '') ||
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: process.env.LLM_MODEL || 'qwen-plus',
  };
}

function getDefaultAiProvider(): AiProvider {
  const raw =
    process.env.DEFAULT_AI_PROVIDER ||
    process.env.AI_PROVIDER ||
    process.env.LLM_PROVIDER ||
    'qwen';

  return raw.toLowerCase() === 'gemini' ? 'gemini' : 'qwen';
}

function truncate(text: string, maxLen = 12000) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...(truncated)` : text;
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

function decodeXmlEntities(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_m, num) =>
      String.fromCharCode(parseInt(num, 10))
    );
}

function extractTextFromSlideXml(xml: string) {
  const matches = [...xml.matchAll(/<a:t[^>]*>(.*?)<\/a:t>/g)];
  const raw = matches.map((m) => decodeXmlEntities(m[1] || '')).join(' ');
  return raw.replace(/\s+/g, ' ').trim();
}

async function extractPptxSlideText(
  buffer: ArrayBuffer,
  pageNumber: number
): Promise<{ text: string; totalPages: number; outOfRange: boolean }> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = zip.file(/ppt\/slides\/slide\d+\.xml$/) || [];

  if (slideFiles.length === 0) {
    throw new Error('No slides were found in the PPTX file.');
  }

  const slides = slideFiles
    .map((file) => {
      const match = file.name.match(/slide(\d+)\.xml$/);
      return { index: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER, name: file.name };
    })
    .sort((a, b) => a.index - b.index);

  const totalPages = slides.length;

  if (pageNumber < 1 || pageNumber > totalPages) {
    return { text: '', totalPages, outOfRange: true };
  }

  const slideFile = zip.file(slides[pageNumber - 1].name);
  if (!slideFile) {
    throw new Error('Requested slide could not be found.');
  }

  const xml = await slideFile.async('string');
  const text = extractTextFromSlideXml(xml);

  return { text, totalPages, outOfRange: false };
}

async function callGeminiText(prompt: string) {
  const { apiKey, baseUrl, model } = getGeminiConfig();

  const endpoint = `${baseUrl}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
        },
      }),
    },
    120000
  );

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${truncate(raw, 1200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${truncate(raw, 1200)}`);
  }

  const blockedReason =
    data?.promptFeedback?.blockReason || data?.prompt_feedback?.block_reason;

  if (blockedReason) {
    throw new Error(`Gemini blocked the request: ${String(blockedReason)}`);
  }

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

  throw new Error(`Gemini returned empty content: ${truncate(raw, 1200)}`);
}

function extractQwenText(data: any): string {
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.output?.choices?.[0]?.message?.content;

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

async function callQwenText(prompt: string) {
  const { apiKey, baseUrl, model } = getQwenConfig();
  const endpoint = `${baseUrl}/chat/completions`;

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              'You are an educational assistant. Summarize slide content clearly and accurately for students. Highlight key concepts, definitions, and takeaways.',
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

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Qwen request failed: ${response.status} ${truncate(raw, 1200)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Qwen returned invalid JSON: ${truncate(raw, 1200)}`);
  }

  const text = extractQwenText(data);
  if (text) return text;

  throw new Error(`Qwen returned empty content: ${truncate(raw, 1200)}`);
}

async function getChapter(
  supabase: SupabaseClient,
  chapterId: string
): Promise<ChapterRow | null> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id,title,mime_type,ppt')
    .eq('id', chapterId)
    .single();

  if (error || !data) {
    console.error('[page-summary] getChapter error:', error);
    return null;
  }

  return data as ChapterRow;
}

function isPptxFile(chapter: ChapterRow) {
  const name = chapter.ppt?.originalName?.toLowerCase() || '';
  const mime = chapter.mime_type || '';
  return (
    mime ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    name.endsWith('.pptx')
  );
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const chaptersIndex = pathParts.indexOf('chapters');
    const chapterId = chaptersIndex >= 0 ? pathParts[chaptersIndex + 1] : '';

    if (!chapterId) {
      return json({ ok: false, error: 'Missing chapterId' }, 400);
    }

    const body = (await req.json().catch(() => null)) as SummaryRequestBody | null;
    const pageNumber = Number(body?.pageNumber);

    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return json({ ok: false, error: 'Invalid page number.' }, 400);
    }

    const supabase = getSupabaseAdmin();
    const chapter = await getChapter(supabase, chapterId);

    if (!chapter) {
      return json({ ok: false, error: 'Chapter not found.' }, 404);
    }

    const storagePath = chapter.ppt?.storagePath;
    if (!storagePath) {
      return json({ ok: false, error: 'No uploaded slide deck found for this chapter.' }, 409);
    }

    if (!isPptxFile(chapter)) {
      return json(
        {
          ok: false,
          error: 'Only PPTX files are supported for page summaries at the moment.',
        },
        415
      );
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) {
      console.error('[page-summary] storage download error:', error);
      return json(
        {
          ok: false,
          error: 'Failed to download the slide deck from storage.',
        },
        500
      );
    }

    const buffer = await data.arrayBuffer();
    const { text, totalPages, outOfRange } = await extractPptxSlideText(
      buffer,
      Math.floor(pageNumber)
    );

    if (outOfRange) {
      return json(
        {
          ok: false,
          error: 'Page number out of range.',
          totalPages,
        },
        400
      );
    }

    if (!text || text.length < 10) {
      return json(
        {
          ok: false,
          error: 'No readable text was found on this slide.',
          totalPages,
        },
        422
      );
    }

    const prompt = `You are an educational assistant. Based on the following content extracted from page ${pageNumber} of the lecture slides, provide a clear and concise summary suitable for students. Highlight the key concepts, important definitions, and main takeaways. Content: ${truncate(
      text,
      12000
    )}`;

    const provider = getDefaultAiProvider();
    let summary = '';

    if (provider === 'gemini') {
      summary = await callGeminiText(prompt);
    } else {
      try {
        summary = await callQwenText(prompt);
      } catch (qwenError) {
        if (!hasGeminiApiKey()) throw qwenError;
        console.warn('[page-summary] Qwen failed, fallback to Gemini:', qwenError);
        summary = await callGeminiText(prompt);
      }
    }

    return json({
      ok: true,
      summary,
      provider,
      pageNumber: Math.floor(pageNumber),
      totalPages,
    });
  } catch (err) {
    console.error('[page-summary] handler error:', err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown server error',
      },
      500
    );
  }
}
