import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

type SummaryRequestBody = {
  pageNumber?: number;
  chapterId?: string;
};

type AiProvider = 'qwen' | 'gemini';
type SummarySource = AiProvider | 'fallback';

type CachedSummaryEntry = {
  summary: string;
  provider: SummarySource;
  updatedAt: string;
};

type ChapterPptMeta = {
  supabaseUrl?: string;
  originalName?: string;
  storagePath?: string;
  relevant_reading?: string | null;
  is_reading_published?: boolean;
  last_processed_at?: string | null;
  pageTextMap?: Record<string, string> | null;
  pageSummaryCache?: Record<string, CachedSummaryEntry> | null;
  pageCount?: number | null;
  pageIndexReady?: boolean | null;
  pageIndexError?: string | null;
};

type ChapterRow = {
  id: string;
  title: string;
  mime_type?: string | null;
  ppt: ChapterPptMeta | null;
};

const MAX_MODEL_OUTPUT_TOKENS = 180;
const HANDLER_BUDGET_MS = 7000;
const PRIMARY_MODEL_TIMEOUT_MS = 3200;
const SECONDARY_MODEL_TIMEOUT_MS = 1600;

const SUMMARY_SYSTEM_PROMPT =
  'You are an educational assistant. Return 3-5 concise markdown bullet points only. Focus on key concepts, definitions, relationships, and takeaways. No intro, no conclusion, no extra commentary.';

function createReqTag(prefix: string) {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function getHeader(req: any, name: string) {
  const headers = req?.headers;
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || '';
  }

  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) return String(value[0] || '');
  return value ? String(value) : '';
}

function getMethod(req: any) {
  return String(req?.method || 'GET').toUpperCase();
}

function getRequestUrl(req: any) {
  try {
    if (req?.url && /^https?:\/\//i.test(String(req.url))) {
      return new URL(String(req.url));
    }
  } catch {}

  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || 'localhost:3000';
  const protocol = (getHeader(req, 'x-forwarded-proto') || 'https').split(',')[0].trim();
  const path = String(req?.originalUrl || req?.url || '/');
  return new URL(path.startsWith('http') ? path : `${protocol}://${host}${path}`);
}

async function readNodeRequestBody(req: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function parseJsonBody(req: any, reqTag: string): Promise<SummaryRequestBody | null> {
  try {
    if (req && typeof req.json === 'function') {
      return (await req.json()) as SummaryRequestBody;
    }

    if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body as SummaryRequestBody;
    }

    if (typeof req?.body === 'string' && req.body.trim()) {
      return JSON.parse(req.body) as SummaryRequestBody;
    }

    if (Buffer.isBuffer(req?.body)) {
      return JSON.parse(req.body.toString('utf8')) as SummaryRequestBody;
    }

    if (typeof req?.rawBody === 'string' && req.rawBody.trim()) {
      return JSON.parse(req.rawBody) as SummaryRequestBody;
    }

    if (Buffer.isBuffer(req?.rawBody)) {
      return JSON.parse(req.rawBody.toString('utf8')) as SummaryRequestBody;
    }

    if (typeof req?.on === 'function') {
      const raw = await readNodeRequestBody(req);
      if (!raw.trim()) return null;
      return JSON.parse(raw) as SummaryRequestBody;
    }

    return null;
  } catch (err) {
    console.warn(`[${reqTag}] parseJsonBody failed:`, err);
    return null;
  }
}

function sendJson(res: any, data: unknown, status = 200) {
  const payload = JSON.stringify(data);

  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store');
    }
    return res.status(status).json(data);
  }

  if (res && typeof res.setHeader === 'function' && typeof res.end === 'function') {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(payload);
    return;
  }

  return new Response(payload, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
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

function hasGeminiApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function hasQwenApiKey() {
  return Boolean(
    process.env.QWEN_API_KEY ||
      process.env.DASHSCOPE_API_KEY ||
      process.env.LLM_API_KEY
  );
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY.');

  return {
    apiKey,
    baseUrl:
      process.env.GEMINI_BASE_URL?.replace(/\/$/, '') ||
      'https://generativelanguage.googleapis.com/v1beta',
    model: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  };
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

function getProviderOrder(preferred: AiProvider): AiProvider[] {
  const providers: AiProvider[] = [];

  if (preferred === 'gemini') {
    if (hasGeminiApiKey()) providers.push('gemini');
    if (hasQwenApiKey()) providers.push('qwen');
  } else {
    if (hasQwenApiKey()) providers.push('qwen');
    if (hasGeminiApiKey()) providers.push('gemini');
  }

  return providers;
}

function truncate(text: string, maxLen = 12000) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...(truncated)` : text;
}

function normalizeMultilineText(text: string) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoIdeaUnits(text: string): string[] {
  const normalized = normalizeMultilineText(text).replace(/\n/g, '. ');
  const raw = normalized
    .split(/(?:•|-|\u2022|\n|[。！？!?;；]+|(?<=\.)\s+)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const cleaned = item
      .replace(/^[-*•]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 4) continue;
    if (seen.has(cleaned.toLowerCase())) continue;

    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
  }

  return out;
}

function normalizeSummaryText(text: string): string {
  const cleaned = text.replace(/\r/g, '').trim();
  if (!cleaned) return '';

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const bulletLike = lines.filter((line) => /^[-*•]\s+/.test(line));
  if (bulletLike.length >= 2) {
    return bulletLike
      .slice(0, 5)
      .map((line) => `- ${line.replace(/^[-*•]\s+/, '').trim()}`)
      .join('\n');
  }

  const ideaUnits = splitIntoIdeaUnits(cleaned).slice(0, 5);
  if (ideaUnits.length > 0) {
    return ideaUnits.map((line) => `- ${truncate(line, 180)}`).join('\n');
  }

  return `- ${truncate(cleaned, 180)}`;
}

function buildFallbackSummary(slideText: string, pageNumber: number): string {
  const units = splitIntoIdeaUnits(slideText);

  if (units.length === 0) {
    return `- Slide ${pageNumber} contains limited readable text.\n- Please review the slide visually for diagrams, formulas, or images that may not be captured as text.`;
  }

  const bullets = units.slice(0, 4).map((item) => `- ${truncate(item, 180)}`);

  if (bullets.length < 3) {
    bullets.push(
      `- This is an extractive fallback summary generated because the AI response was unavailable or too slow.`
    );
  }

  return bullets.join('\n');
}

function buildModelPrompt(slideText: string, pageNumber: number, totalPages: number) {
  const compact = truncate(slideText, 5000);

  return [
    `Slide ${pageNumber} of ${totalPages}.`,
    `Summarize the following slide content in 3-5 concise markdown bullet points.`,
    `Focus on key concepts, definitions, relationships, and takeaways.`,
    `Do not add any intro or conclusion.`,
    '',
    'Slide content:',
    compact,
  ].join('\n');
}

function extractQwenText(data: any): string {
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.output?.choices?.[0]?.message?.content;

  if (typeof content === 'string') return content.trim();

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

function extractGeminiText(data: any): string {
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

  return '';
}

async function fetchTextResultWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 1000
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    return { response, text };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Model request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callQwenText(prompt: string, timeoutMs: number): Promise<string> {
  const { apiKey, baseUrl, model } = getQwenConfig();
  const endpoint = `${baseUrl}/chat/completions`;

  const { response, text: raw } = await fetchTextResultWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: MAX_MODEL_OUTPUT_TOKENS,
        stream: false,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Qwen request failed: ${response.status} ${truncate(raw, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Qwen returned invalid JSON: ${truncate(raw, 500)}`);
  }

  const text = extractQwenText(data);
  if (!text) throw new Error(`Qwen returned empty content: ${truncate(raw, 500)}`);

  return normalizeSummaryText(text);
}

async function callGeminiText(prompt: string, timeoutMs: number): Promise<string> {
  const { apiKey, baseUrl, model } = getGeminiConfig();
  const endpoint = `${baseUrl}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { response, text: raw } = await fetchTextResultWithTimeout(
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
                text: `${SUMMARY_SYSTEM_PROMPT}\n\n${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: MAX_MODEL_OUTPUT_TOKENS,
        },
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${truncate(raw, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${truncate(raw, 500)}`);
  }

  const text = extractGeminiText(data);
  if (!text) throw new Error(`Gemini returned empty content: ${truncate(raw, 500)}`);

  return normalizeSummaryText(text);
}

async function getChapter(
  supabase: SupabaseClient,
  chapterId: string,
  reqTag: string
): Promise<ChapterRow | null> {
  const { data, error } = await supabase
    .from('chapters')
    .select('id,title,mime_type,ppt')
    .eq('id', chapterId)
    .single();

  if (error || !data) {
    console.error(`[${reqTag}] getChapter error:`, error);
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

function getPageText(ppt: ChapterPptMeta | null | undefined, pageNumber: number) {
  const map = ppt?.pageTextMap;
  if (!map) return '';

  return String(map[String(pageNumber)] || '').trim();
}

function getCachedSummary(
  ppt: ChapterPptMeta | null | undefined,
  pageNumber: number
): CachedSummaryEntry | null {
  const cache = ppt?.pageSummaryCache;
  if (!cache) return null;

  const item = cache[String(pageNumber)];
  if (!item?.summary) return null;
  return item;
}

async function saveSummaryCache(
  supabase: SupabaseClient,
  chapter: ChapterRow,
  pageNumber: number,
  summary: string,
  provider: SummarySource,
  reqTag: string
) {
  try {
    const nextPpt: ChapterPptMeta = {
      ...(chapter.ppt || {}),
      pageSummaryCache: {
        ...(chapter.ppt?.pageSummaryCache || {}),
        [String(pageNumber)]: {
          summary,
          provider,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    await supabase
      .from('chapters')
      .update({ ppt: nextPpt as any })
      .eq('id', chapter.id);
  } catch (err) {
    console.warn(`[${reqTag}] save cache failed:`, err);
  }
}

function getRemainingMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

async function generateSummaryWithFallback(args: {
  slideText: string;
  pageNumber: number;
  totalPages: number;
  preferredProvider: AiProvider;
  deadline: number;
  reqTag: string;
}): Promise<{ summary: string; provider: SummarySource; mode: 'model' | 'fallback' }> {
  const { slideText, pageNumber, totalPages, preferredProvider, deadline, reqTag } = args;
  const prompt = buildModelPrompt(slideText, pageNumber, totalPages);
  const fallback = buildFallbackSummary(slideText, pageNumber);

  const providers = getProviderOrder(preferredProvider);

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const remaining = getRemainingMs(deadline);
    const timeoutMs = Math.min(
      i === 0 ? PRIMARY_MODEL_TIMEOUT_MS : SECONDARY_MODEL_TIMEOUT_MS,
      Math.max(0, remaining - 250)
    );

    if (timeoutMs < 700) {
      console.warn(`[${reqTag}] skip ${provider}: not enough time budget left`);
      break;
    }

    try {
      console.log(`[${reqTag}] trying provider=${provider} timeoutMs=${timeoutMs}`);

      const summary =
        provider === 'gemini'
          ? await callGeminiText(prompt, timeoutMs)
          : await callQwenText(prompt, timeoutMs);

      if (summary.trim()) {
        return { summary, provider, mode: 'model' };
      }
    } catch (err) {
      console.warn(`[${reqTag}] provider ${provider} failed:`, err);
    }
  }

  return {
    summary: fallback,
    provider: 'fallback',
    mode: 'fallback',
  };
}

function getChapterIdFromRequest(url: URL, body: SummaryRequestBody | null) {
  const pathParts = url.pathname.split('/').filter(Boolean);
  const chaptersIndex = pathParts.indexOf('chapters');
  const fromPath = chaptersIndex >= 0 ? pathParts[chaptersIndex + 1] : '';

  const fromQuery = url.searchParams.get('chapterId') || '';
  const fromBody = String(body?.chapterId || '').trim();

  return fromPath || fromQuery || fromBody;
}

export default async function handler(req: any, res?: any) {
  const reqTag = createReqTag('page-summary');
  const method = getMethod(req);

  console.log(`[${reqTag}] entered`, {
    method,
    url: String(req?.url || req?.originalUrl || ''),
    bodyType: typeof req?.body,
    hasJson: typeof req?.json === 'function',
    hasRes: Boolean(res),
  });

  if (method !== 'POST') {
    console.warn(`[${reqTag}] reject method=${method}`);
    return sendJson(res, { ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const deadline = Date.now() + HANDLER_BUDGET_MS;
    const body = await parseJsonBody(req, reqTag);
    const url = getRequestUrl(req);
    const chapterId = getChapterIdFromRequest(url, body);

    console.log(`[${reqTag}] parsed`, {
      pathname: url.pathname,
      chapterId,
      pageNumber: body?.pageNumber,
    });

    if (!chapterId) {
      console.warn(`[${reqTag}] missing chapterId`);
      return sendJson(res, { ok: false, error: 'Missing chapterId' }, 400);
    }

    const pageNumber = Number(body?.pageNumber);

    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      console.warn(`[${reqTag}] invalid pageNumber`, { raw: body?.pageNumber });
      return sendJson(res, { ok: false, error: 'Invalid page number.' }, 400);
    }

    const normalizedPageNumber = Math.floor(pageNumber);

    const supabase = getSupabaseAdmin();
    const chapter = await getChapter(supabase, chapterId, reqTag);

    if (!chapter) {
      console.warn(`[${reqTag}] chapter not found`);
      return sendJson(res, { ok: false, error: 'Chapter not found.' }, 404);
    }

    if (!chapter.ppt?.storagePath && !chapter.ppt?.supabaseUrl) {
      console.warn(`[${reqTag}] no slide deck found`);
      return sendJson(
        res,
        { ok: false, error: 'No uploaded slide deck found for this chapter.' },
        400
      );
    }

    if (!isPptxFile(chapter)) {
      console.warn(`[${reqTag}] unsupported file type`, {
        mime: chapter.mime_type,
        name: chapter.ppt?.originalName,
      });
      return sendJson(
        res,
        {
          ok: false,
          error: 'Page Summary currently supports PPTX files only. PDF files are not supported yet.',
        },
        415
      );
    }

    if (chapter.ppt?.pageIndexReady === false) {
      console.warn(`[${reqTag}] page index not ready`);
      return sendJson(
        res,
        {
          ok: false,
          error:
            chapter.ppt?.pageIndexError ||
            'Page text index is still being prepared for this chapter. Please try again later.',
        },
        409
      );
    }

    const totalPages =
      Number(chapter.ppt?.pageCount || 0) ||
      Object.keys(chapter.ppt?.pageTextMap || {}).length;

    if (totalPages > 0 && normalizedPageNumber > totalPages) {
      console.warn(`[${reqTag}] page out of range`, {
        normalizedPageNumber,
        totalPages,
      });
      return sendJson(
        res,
        {
          ok: false,
          error: 'Page number out of range.',
          totalPages,
        },
        400
      );
    }

    const cached = getCachedSummary(chapter.ppt, normalizedPageNumber);
    if (cached) {
      console.log(`[${reqTag}] cache hit page=${normalizedPageNumber}`);
      return sendJson(res, {
        ok: true,
        summary: cached.summary,
        provider: cached.provider,
        mode: 'cache',
        pageNumber: normalizedPageNumber,
        totalPages,
      });
    }

    const slideText = getPageText(chapter.ppt, normalizedPageNumber);
    if (!slideText) {
      console.warn(`[${reqTag}] missing slideText`, {
        page: normalizedPageNumber,
        hasPageTextMap: Boolean(chapter.ppt?.pageTextMap),
      });
      return sendJson(
        res,
        {
          ok: false,
          error:
            'Page text index is not ready for this page. Please reprocess the chapter material first.',
          totalPages,
        },
        409
      );
    }

    const preferredProvider = getDefaultAiProvider();
    const result = await generateSummaryWithFallback({
      slideText,
      pageNumber: normalizedPageNumber,
      totalPages: Math.max(totalPages, normalizedPageNumber),
      preferredProvider,
      deadline,
      reqTag,
    });

    const finalSummary = normalizeSummaryText(result.summary);
    if (!finalSummary.trim()) {
      console.error(`[${reqTag}] empty summary after normalization`);
      return sendJson(
        res,
        { ok: false, error: 'Summary generation produced empty content.' },
        500
      );
    }

    void saveSummaryCache(
      supabase,
      chapter,
      normalizedPageNumber,
      finalSummary,
      result.provider,
      reqTag
    );

    console.log(`[${reqTag}] success`, {
      provider: result.provider,
      mode: result.mode,
      pageNumber: normalizedPageNumber,
      totalPages,
    });

    return sendJson(res, {
      ok: true,
      summary: finalSummary,
      provider: result.provider,
      mode: result.mode,
      pageNumber: normalizedPageNumber,
      totalPages,
    });
  } catch (err) {
    console.error(`[${reqTag}] handler error:`, err);
    return sendJson(
      res,
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown server error',
      },
      500
    );
  }
}