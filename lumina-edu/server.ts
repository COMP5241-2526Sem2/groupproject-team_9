import express, { type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';

import processChapterMaterialHandler from './api/process-chapter-material';
import qwenChatDocHandler from './api/qwen-chat-doc';
import pageSummaryHandler from './api/page-summary';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function getBaseUrl(req: ExpressRequest) {
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol =
    req.headers['x-forwarded-proto']?.toString().split(',')[0] ||
    req.protocol ||
    'http';

  return `${protocol}://${host}`;
}

function buildWebRequest(req: ExpressRequest): Request {
  const url = `${getBaseUrl(req)}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  let body: BodyInit | undefined = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const contentType = req.headers['content-type'] || '';

    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      body = req.body as BodyInit;
    } else if (contentType.includes('application/json')) {
      body = JSON.stringify(req.body ?? {});
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.body ?? {})) {
        params.append(key, String(value));
      }
      body = params.toString();
    } else if (req.body != null) {
      body = JSON.stringify(req.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
    body,
  });
}

async function sendWebResponse(webResponse: Response, res: ExpressResponse) {
  res.status(webResponse.status);

  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-length') return;
    res.setHeader(key, value);
  });

  const arrayBuffer = await webResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  res.send(buffer);
}

async function runHandler(
  req: ExpressRequest,
  res: ExpressResponse,
  handler: (request: Request) => Promise<Response>
) {
  try {
    const webRequest = buildWebRequest(req);
    const webResponse = await handler(webRequest);
    await sendWebResponse(webResponse, res);
  } catch (error) {
    console.error('[server bridge] handler error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
}

app.post('/api/process-chapter-material', async (req, res) => {
  await runHandler(req, res, processChapterMaterialHandler);
});

app.post('/api/qwen-chat-doc', async (req, res) => {
  await runHandler(req, res, qwenChatDocHandler);
});

app.post('/api/chapters/:chapterId/page-summary', async (req, res) => {
  await runHandler(req, res, pageSummaryHandler);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});