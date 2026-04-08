import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

type ChatMessage = {
  role?: 'user' | 'assistant';
  content?: string;
};

type CachedSummaryEntry = {
  summary: string;
  provider: string;
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
  extracted_text?: string | null;
  content_status?: string | null;
  processing_stage?: string | null;
  processing_progress?: number | null;
  processing_error?: string | null;
  ppt?: ChapterPptMeta | null;
};

type AiProvider = 'qwen' | 'gemini';
type RetrievedSection = {
  label: string;
  text: string;
  score: number;
  page?: number;
};

const HANDLER_BUDGET_MS = 8500;
const PRIMARY_MODEL_TIMEOUT_MS = 4200;
const SECONDARY_MODEL_TIMEOUT_MS = 2200;
const MAX_QWEN_OUTPUT_TOKENS = 650;
const MAX_GEMINI_OUTPUT_TOKENS = 650;

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 1600;
const MAX_CONTEXT_CHARS = 6500;
const MAX_RETRIEVED_SECTIONS = 6;

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

async function parseJsonBody(req: any, reqTag: string): Promise<any | null> {
  try {
    if (req && typeof req.json === 'function') {
      return await req.json();
    }

    if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body;
    }

    if (typeof req?.body === 'string' && req.body.trim()) {
      return JSON.parse(req.body);
    }

    if (Buffer.isBuffer(req?.body)) {
      return JSON.parse(req.body.toString('utf8'));
    }

    if (typeof req?.rawBody === 'string' && req.rawBody.trim()) {
      return JSON.parse(req.rawBody);
    }

    if (Buffer.isBuffer(req?.rawBody)) {
      return JSON.parse(req.rawBody.toString('utf8'));
    }

    if (typeof req?.on === 'function') {
      const raw = await readNodeRequestBody(req);
      if (!raw.trim()) return null;
      return JSON.parse(raw);
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

function getQwenConfig() {
  const apiKey =
    process.env.QWEN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.LLM_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error('Missing QWEN_API_KEY (or DASHSCOPE_API_KEY / LLM_API_KEY)');
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

function truncate(text: string, maxLen = 1200) {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...(truncated)` : text;
}

function normalizeText(text: string) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function buildHistoryText(history: ChatMessage[] = []) {
  if (!Array.isArray(history) || history.length === 0) return '';

  const raw = history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((msg) => {
      const role = msg.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(msg.content || '').trim()}`;
    })
    .join('\n\n');

  return truncate(raw, MAX_HISTORY_CHARS);
}

function extractKeywords(question: string) {
  const raw = question
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'“”‘’/\\|]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const stopwords = new Set([
    'what',
    'which',
    'when',
    'where',
    'why',
    'how',
    'does',
    'do',
    'did',
    'the',
    'this',
    'that',
    'with',
    'from',
    'into',
    'about',
    'have',
    'has',
    'had',
    'are',
    'is',
    'was',
    'were',
    'for',
    'and',
    'but',
    'can',
    'could',
    'would',
    'should',
    'please',
    'tell',
    'explain',
    'chapter',
    'material',
    'student',
    'page',
    'slide',
    '页',
    '这个',
    '那个',
    '一下',
    '一下子',
    '帮我',
    '看看',
    '什么',
    '怎么',
    '为什么',
    '可以',
    '是否',
    '还有',
  ]);

  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const token of raw) {
    if (token.length < 2) continue;
    if (stopwords.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }

  return keywords.slice(0, 12);
}

function extractRequestedPages(question: string, maxPage?: number) {
  const pages = new Set<number>();
  const regexes = [
    /\bpages\s*(\d+)\s*-\s*(\d+)\b/gi,
    /\bpage\s*(\d+)\b/gi,
    /\bslide\s*(\d+)\b/gi,
    /\bp\.?\s*(\d+)\b/gi,
    /第\s*(\d+)\s*页到第\s*(\d+)\s*页/g,
    /第\s*(\d+)\s*页至第\s*(\d+)\s*页/g,
    /第\s*(\d+)\s*页/g,
  ];

  for (const re of regexes) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(question)) !== null) {
      const nums = match
        .slice(1)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0);

      if (nums.length === 1) {
        pages.add(nums[0]);
      } else if (nums.length === 2) {
        const [a, b] = nums[0] <= nums[1] ? nums : [nums[1], nums[0]];
        for (let p = a; p <= Math.min(b, a + 5); p += 1) {
          pages.add(p);
        }
      }
    }
  }

  return [...pages]
    .filter((p) => !maxPage || p <= maxPage)
    .sort((a, b) => a - b)
    .slice(0, 6);
}

function splitIntoChunks(text: string, chunkSize = 1200, overlap = 120) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      const lineBreak = normalized.lastIndexOf('\n', end);
      const sentenceBreak = Math.max(
        normalized.lastIndexOf('. ', end),
        normalized.lastIndexOf('。', end),
        normalized.lastIndexOf('? ', end),
        normalized.lastIndexOf('! ', end)
      );

      const betterEnd = [paragraphBreak, lineBreak, sentenceBreak]
        .filter((idx) => idx > start + Math.floor(chunkSize * 0.55))
        .sort((a, b) => b - a)[0];

      if (betterEnd) end = betterEnd + 1;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function extractPagesFromText(text: string) {
  const normalized = normalizeText(text);
  const regex = /^\[Page\s+(\d+)\]\s*$/gim;
  const matches = [...normalized.matchAll(regex)];

  if (!matches.length) {
    return normalized ? [{ page: 1, content: normalized }] : [];
  }

  const pages: Array<{ page: number; content: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const page = Number(current[1]);
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? normalized.length;
    const content = normalized.slice(start, end).trim();

    pages.push({
      page,
      content,
    });
  }

  return pages;
}

function scoreText(text: string, question: string, keywords: string[], requestedPages: number[], page?: number) {
  const c = text.toLowerCase();
  const q = question.toLowerCase();

  let score = 0;

  for (const kw of keywords) {
    const count = c.split(kw).length - 1;
    score += count * 2;
  }

  if (q.length > 8 && c.includes(q)) score += 10;

  if (typeof page === 'number' && requestedPages.includes(page)) {
    score += 30;
  }

  if (c.includes('definition') || c.includes('define')) {
    if (q.includes('what is') || q.includes('define')) score += 3;
  }

  return score;
}

function buildSectionsFromPageTextMap(
  pageTextMap: Record<string, string> | null | undefined,
  question: string,
  keywords: string[],
  requestedPages: number[]
): RetrievedSection[] {
  if (!pageTextMap) return [];

  const entries = Object.entries(pageTextMap)
    .map(([key, value]) => ({
      page: Number(key),
      text: normalizeText(value || ''),
    }))
    .filter((x) => Number.isFinite(x.page) && x.page > 0 && x.text);

  return entries.map(({ page, text }) => ({
    label: `Page ${page}`,
    text,
    page,
    score: scoreText(text, question, keywords, requestedPages, page),
  }));
}

function buildSectionsFromExtractedText(
  extractedText: string,
  question: string,
  keywords: string[],
  requestedPages: number[]
): RetrievedSection[] {
  const pages = extractPagesFromText(extractedText);
  if (pages.length > 1) {
    return pages.map((p) => ({
      label: `Page ${p.page}`,
      text: normalizeText(p.content),
      page: p.page,
      score: scoreText(p.content, question, keywords, requestedPages, p.page),
    }));
  }

  return splitIntoChunks(extractedText, 1200, 120).map((chunk, idx) => ({
    label: `Chunk ${idx + 1}`,
    text: chunk,
    score: scoreText(chunk, question, keywords, requestedPages),
  }));
}

function buildSectionsFromReading(
  reading: string,
  question: string,
  keywords: string[]
): RetrievedSection[] {
  const normalized = normalizeText(reading);
  if (!normalized) return [];

  return splitIntoChunks(normalized, 1200, 120).map((chunk, idx) => ({
    label: `Reading ${idx + 1}`,
    text: chunk,
    score: scoreText(chunk, question, keywords, []),
  }));
}

function retrieveRelevantContext(args: {
  extractedText: string;
  reading: string;
  pageTextMap?: Record<string, string> | null;
  pageCount?: number | null;
  question: string;
}) {
  const { extractedText, reading, pageTextMap, pageCount, question } = args;

  const keywords = extractKeywords(question);
  const requestedPages = extractRequestedPages(question, pageCount || undefined);

  const pageSections = buildSectionsFromPageTextMap(
    pageTextMap,
    question,
    keywords,
    requestedPages
  );

  const baseSections =
    pageSections.length > 0
      ? pageSections
      : buildSectionsFromExtractedText(extractedText, question, keywords, requestedPages);

  const readingSections = buildSectionsFromReading(reading, question, keywords);

  const allSections = [...baseSections, ...readingSections]
    .filter((s) => s.text)
    .sort((a, b) => b.score - a.score);

  const chosen: RetrievedSection[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  for (const section of allSections) {
    const key = `${section.label}::${section.text.slice(0, 120)}`;
    if (seen.has(key)) continue;

    const rendered = `[${section.label}]\n${section.text}`;
    if (chosen.length >= MAX_RETRIEVED_SECTIONS) break;
    if (totalChars + rendered.length > MAX_CONTEXT_CHARS && chosen.length > 0) break;

    seen.add(key);
    chosen.push(section);
    totalChars += rendered.length + 2;
  }

  if (chosen.length === 0) {
    const fallback = normalizeText([extractedText, reading].filter(Boolean).join('\n\n'));
    return {
      context: truncate(fallback, MAX_CONTEXT_CHARS),
      sourcePages: [],
    };
  }

  const context = chosen
    .map((section) => `[${section.label}]\n${section.text}`)
    .join('\n\n---\n\n')
    .slice(0, MAX_CONTEXT_CHARS);

  const sourcePages = chosen
    .filter((s) => typeof s.page === 'number')
    .map((s) => s.page as number);

  return {
    context,
    sourcePages: [...new Set(sourcePages)].sort((a, b) => a - b),
  };
}

function buildPrompt(args: {
  chapterTitle: string;
  question: string;
  historyText: string;
  context: string;
  sourcePages: number[];
}) {
  const { chapterTitle, question, historyText, context, sourcePages } = args;

  const pageHint =
    sourcePages.length > 0
      ? `The most relevant chapter pages appear to be: ${sourcePages.join(', ')}. Prioritize those pages if they answer the question.\n`
      : '';

  return `
You are a helpful AI tutor for a university education platform.

Chapter title:
${chapterTitle}

${pageHint}Available chapter context:
${context}

Conversation history:
${historyText || 'No prior conversation.'}

Student question:
${question}

Requirements:
1. Answer primarily based on the chapter context above.
2. If the context clearly supports the answer, explain it naturally and directly.
3. If the context is partially insufficient, say that clearly first, then provide cautious supplemental knowledge.
4. Keep the answer educational, accurate, and easy to follow.
5. Use short sections or bullet points when helpful.
6. If the question refers to a specific page/slide, focus on that page first.
7. Do not mention API details, internal system details, or model names.
`.trim();
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

async function callQwenText(prompt: string, timeoutMs: number) {
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
        max_tokens: MAX_QWEN_OUTPUT_TOKENS,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful academic tutor. Answer clearly, accurately, and concisely. Use the provided chapter context as the main basis. If the context is insufficient, say so clearly before adding cautious supplemental knowledge.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Qwen request failed: ${response.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Qwen returned invalid JSON: ${truncate(raw)}`);
  }

  const content = extractQwenText(data);
  if (content) return normalizeText(content);

  throw new Error(`Qwen returned empty content: ${truncate(raw)}`);
}

async function callGeminiText(prompt: string, timeoutMs: number) {
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
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: MAX_GEMINI_OUTPUT_TOKENS,
        },
      }),
    },
    timeoutMs
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${truncate(raw)}`);
  }

  const content = extractGeminiText(data);
  if (content) return normalizeText(content);

  throw new Error(`Gemini returned empty content: ${truncate(raw)}`);
}

function buildFallbackAnswer(args: {
  question: string;
  context: string;
  sourcePages: number[];
}) {
  const { context, sourcePages } = args;
  const sections = splitIntoChunks(context, 420, 0).slice(0, 3);

  if (sections.length === 0) {
    return `I don't have enough processed chapter content to answer this accurately yet. Please try again after the chapter finishes processing or ask about a more specific part of the material.`;
  }

  const bullets = sections
    .map((section) => section.replace(/^\[[^\]]+\]\n/, '').trim())
    .map((section) => section.split('\n')[0]?.trim() || section.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => `- ${truncate(line, 180)}`);

  const pageNote =
    sourcePages.length > 0
      ? `The most relevant pages appear to be ${sourcePages.join(', ')}.\n\n`
      : '';

  return `${pageNote}I couldn't generate a full model-based answer in time, but based on the chapter material, the most relevant points are:\n${bullets.join('\n')}`;
}

function getRemainingMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

async function generateAnswerWithFallback(args: {
  chapterTitle: string;
  question: string;
  historyText: string;
  context: string;
  sourcePages: number[];
  reqTag: string;
}) {
  const prompt = buildPrompt(args);
  const preferredProvider = getDefaultAiProvider();
  const providers = getProviderOrder(preferredProvider);
  const deadline = Date.now() + HANDLER_BUDGET_MS;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const remaining = getRemainingMs(deadline);
    const timeoutMs = Math.min(
      i === 0 ? PRIMARY_MODEL_TIMEOUT_MS : SECONDARY_MODEL_TIMEOUT_MS,
      Math.max(0, remaining - 300)
    );

    if (timeoutMs < 900) {
      console.warn(`[${args.reqTag}] skip ${provider}: not enough time budget left`);
      break;
    }

    try {
      console.log(`[${args.reqTag}] trying provider=${provider} timeoutMs=${timeoutMs}`);

      const answer =
        provider === 'gemini'
          ? await callGeminiText(prompt, timeoutMs)
          : await callQwenText(prompt, timeoutMs);

      if (answer.trim()) {
        return {
          answer,
          provider,
          mode: 'model' as const,
        };
      }
    } catch (err) {
      console.warn(`[${args.reqTag}] provider ${provider} failed:`, err);
    }
  }

  return {
    answer: buildFallbackAnswer({
      question: args.question,
      context: args.context,
      sourcePages: args.sourcePages,
    }),
    provider: 'fallback',
    mode: 'fallback' as const,
  };
}

export default async function handler(req: any, res?: any) {
  const reqTag = createReqTag('qwen-chat-doc');
  const method = getMethod(req);

  console.log(`[${reqTag}] entered`, {
    method,
    url: String(req?.url || req?.originalUrl || ''),
    bodyType: typeof req?.body,
    hasJson: typeof req?.json === 'function',
    hasRes: Boolean(res),
    host: getHeader(req, 'host'),
  });

  if (method !== 'POST') {
    console.warn(`[${reqTag}] reject method=${method}`);
    return sendJson(res, { ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = await parseJsonBody(req, reqTag);

    const chapterId = String(body?.chapterId || '').trim();
    const question = String(body?.question || '').trim();
    const history = Array.isArray(body?.history) ? body.history : [];

    console.log(`[${reqTag}] parsed`, {
      chapterId,
      questionPreview: truncate(question, 120),
      historyLength: history.length,
    });

    if (!chapterId) {
      console.warn(`[${reqTag}] missing chapterId`);
      return sendJson(res, { ok: false, error: 'Missing chapterId' }, 400);
    }

    if (!question) {
      console.warn(`[${reqTag}] missing question`);
      return sendJson(res, { ok: false, error: 'Missing question' }, 400);
    }

    const { data: chapter, error } = await supabase
      .from('chapters')
      .select('id,title,extracted_text,content_status,processing_stage,processing_progress,processing_error,ppt')
      .eq('id', chapterId)
      .single();

    if (error || !chapter) {
      console.warn(`[${reqTag}] chapter not found`, error);
      return sendJson(res, { ok: false, error: 'Chapter not found' }, 404);
    }

    const typedChapter = chapter as ChapterRow;
    const normalizedStatus = String(typedChapter.content_status || '').toLowerCase();

    if (!['ready', 'completed'].includes(normalizedStatus)) {
      console.warn(`[${reqTag}] chapter not ready`, {
        status: typedChapter.content_status,
        stage: typedChapter.processing_stage,
        progress: typedChapter.processing_progress,
      });

      return sendJson(
        res,
        {
          ok: false,
          error:
            typedChapter.processing_error ||
            'This chapter is still being processed. Please try again later.',
        },
        409
      );
    }

    const extractedText = normalizeText(typedChapter.extracted_text || '');
    const reading = normalizeText(typedChapter?.ppt?.relevant_reading || '');
    const pageTextMap = typedChapter?.ppt?.pageTextMap || null;
    const pageCount =
      Number(typedChapter?.ppt?.pageCount || 0) ||
      Object.keys(pageTextMap || {}).length;

    if (!extractedText && !reading && (!pageTextMap || Object.keys(pageTextMap).length === 0)) {
      console.warn(`[${reqTag}] no processed content available`);
      return sendJson(
        res,
        {
          ok: false,
          error: 'No processed chapter content is available yet.',
        },
        409
      );
    }

    const historyText = buildHistoryText(history);

    const { context, sourcePages } = retrieveRelevantContext({
      extractedText,
      reading,
      pageTextMap,
      pageCount,
      question,
    });

    console.log(`[${reqTag}] context built`, {
      contextChars: context.length,
      sourcePages,
    });

    const result = await generateAnswerWithFallback({
      chapterTitle: typedChapter.title,
      question,
      historyText,
      context,
      sourcePages,
      reqTag,
    });

    console.log(`[${reqTag}] success`, {
      provider: result.provider,
      mode: result.mode,
      answerPreview: truncate(result.answer, 160),
    });

    return sendJson(res, {
      ok: true,
      answer: result.answer,
      provider: result.provider,
      mode: result.mode,
      sourcePages,
    });
  } catch (e: any) {
    console.error(`[${reqTag}] handler error:`, e);
    return sendJson(
      res,
      {
        ok: false,
        error: e?.message || 'Unknown qwen-chat-doc error',
      },
      500
    );
  }
}