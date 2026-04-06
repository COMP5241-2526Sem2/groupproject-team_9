import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

import processChapterMaterialHandler from './process-chapter-material';
import qwenChatDocHandler from './qwen-chat-doc';
import pageSummaryHandler from './page-summary';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 复制 server.ts 里的辅助函数
function buildWebRequest(req, PORT = 3000) {
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol =
    req.headers['x-forwarded-proto']?.toString().split(',')[0] ||
    req.protocol ||
    'http';
  const url = `${protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const contentType = req.headers['content-type'] || '';
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      body = req.body;
    } else if (contentType.includes('application/json')) {
      body = JSON.stringify(req.body ?? {});
    } else if (req.body != null) {
      body = JSON.stringify(req.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url, { method: req.method, headers, body });
}

async function sendWebResponse(webResponse, res) {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') return;
    res.setHeader(key, value);
  });
  const buffer = Buffer.from(await webResponse.arrayBuffer());
  res.send(buffer);
}

async function runHandler(req, res, handler) {
  try {
    const webRequest = buildWebRequest(req);
    const webResponse = await handler(webRequest);
    await sendWebResponse(webResponse, res);
  } catch (error) {
    console.error('[vercel bridge] handler error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// 注册所有路由
app.post('/api/process-chapter-material', (req, res) => {
  runHandler(req, res, processChapterMaterialHandler);
});

app.post('/api/qwen-chat-doc', (req, res) => {
  runHandler(req, res, qwenChatDocHandler);
});

app.post('/api/chapters/:chapterId/page-summary', (req, res) => {
  runHandler(req, res, pageSummaryHandler);
});

export default app;