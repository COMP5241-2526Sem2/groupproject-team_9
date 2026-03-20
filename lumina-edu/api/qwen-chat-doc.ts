import { createClient } from '@supabase/supabase-js';

export const config = {
  runtime: 'nodejs',
};

type ChatMessage = {
  role?: 'user' | 'assistant';
  content?: string;
};

function getSupabaseAdmin() {
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  return {
    apiKey,
    baseUrl:
      process.env.GEMINI_BASE_URL?.replace(/\/$/, '') ||
      'https://generativelanguage.googleapis.com/v1beta',
    model: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
  };
}

function truncate(text: string, maxLen = 1200) {
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

function buildHistoryText(history: ChatMessage[] = []) {
  if (!Array.isArray(history) || history.length === 0) return '';

  return history
    .slice(-8)
    .map((msg) => {
      const role = msg.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(msg.content || '').trim()}`;
    })
    .join('\n\n');
}

function splitIntoChunks(text: string, chunkSize = 1500, overlap = 200) {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      const lineBreak = text.lastIndexOf('\n', end);
      const sentenceBreak = Math.max(
        text.lastIndexOf('. ', end),
        text.lastIndexOf('。', end),
        text.lastIndexOf('? ', end),
        text.lastIndexOf('! ', end)
      );

      const betterEnd = [paragraphBreak, lineBreak, sentenceBreak]
        .filter((idx) => idx > start + Math.floor(chunkSize * 0.6))
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

function scoreChunk(chunk: string, query: string) {
  const q = query.toLowerCase();
  const c = chunk.toLowerCase();

  const keywords = q
    .split(/[\s,.;:!?()[\]{}"']+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);

  let score = 0;

  for (const kw of keywords) {
    const count = c.split(kw).length - 1;
    score += count;
  }

  if (c.includes(q)) score += 8;

  return score;
}

function retrieveRelevantContext(text: string, reading: string, question: string) {
  const full = [text, reading].filter(Boolean).join('\n\n');
  const chunks = splitIntoChunks(full, 1500, 200);

  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, question),
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 5).map((x) => x.chunk);

  if (top.length === 0) {
    return full.slice(0, 6000);
  }

  return top.join('\n\n---\n\n').slice(0, 8000);
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

  if (typeof data?.text === 'string') {
    return data.text.trim();
  }

  return '';
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
        systemInstruction: {
          parts: [
            {
              text:
                'You are a helpful academic tutor. Answer clearly, accurately, and concisely. Use only the provided chapter context as the main basis. If the context is insufficient, say so clearly before adding cautious supplemental knowledge.',
            },
          ],
        },
      }),
    },
    120000
  );

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${truncate(raw)}`);
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${truncate(raw)}`);
  }

  const blockedReason =
    data?.promptFeedback?.blockReason || data?.prompt_feedback?.block_reason;

  if (blockedReason) {
    throw new Error(`Gemini blocked the request: ${String(blockedReason)}`);
  }

  const content = extractGeminiText(data);

  if (content) return content;

  throw new Error(`Gemini returned empty content: ${truncate(raw)}`);
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json().catch(() => null);

    const chapterId = String(body?.chapterId || '').trim();
    const question = String(body?.question || '').trim();
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!chapterId) {
      return json({ ok: false, error: 'Missing chapterId' }, 400);
    }

    if (!question) {
      return json({ ok: false, error: 'Missing question' }, 400);
    }

    const { data: chapter, error } = await supabase
      .from('chapters')
      .select('*')
      .eq('id', chapterId)
      .single();

    if (error || !chapter) {
      return json({ ok: false, error: 'Chapter not found' }, 404);
    }

    if (chapter.content_status !== 'ready') {
      return json(
        {
          ok: false,
          error: 'This chapter is still being processed. Please try again later.',
        },
        409
      );
    }

    const extractedText = String(chapter.extracted_text || '').trim();
    const reading = String(chapter?.ppt?.relevant_reading || '').trim();

    if (!extractedText && !reading) {
      return json(
        {
          ok: false,
          error: 'No processed chapter content is available yet.',
        },
        409
      );
    }

    const historyText = buildHistoryText(history);
    const context = retrieveRelevantContext(extractedText, reading, question);

    const prompt = `
You are a helpful AI tutor for a university education platform.

Chapter title: ${chapter.title}

Available chapter context:
${context}

Conversation history:
${historyText || 'No prior conversation.'}

Student question:
${question}

Requirements:
1. Answer primarily based on the chapter context above.
2. If the context clearly supports the answer, explain it naturally.
3. If the context is insufficient, say so clearly, then provide cautious supplemental knowledge.
4. Keep the answer educational, accurate, and easy to follow.
5. Use short sections or bullet points when helpful.
6. Do not mention API details, internal system details, or model names.
`.trim();

    const answer = await callGeminiText(prompt);

    return json({
      ok: true,
      answer,
    });
  } catch (e: any) {
    console.error('gemini-chat-doc error:', e);
    return json(
      {
        ok: false,
        error: e?.message || 'Unknown gemini-chat-doc error',
      },
      500
    );
  }
}