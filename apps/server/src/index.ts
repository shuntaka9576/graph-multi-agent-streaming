import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';

import { chatRoute } from './routes/chat';

const app = new Hono();

// API routes
app.route('/api', chatRoute);

// Serve static files for SPA
const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

const serveStaticFile = async (filePath: string): Promise<Response | null> => {
  try {
    const content = fs.readFileSync(filePath);
    return new Response(content, {
      headers: {
        'Content-Type': getMimeType(filePath),
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch {
    return null;
  }
};

// SPAディレクトリ
// Lambda: /var/task/spa, 開発: ./dist/spa
const spaDir = process.env.AWS_LAMBDA_FUNCTION_NAME
  ? path.join(process.cwd(), 'spa')
  : path.join(process.cwd(), 'dist', 'spa');

// Static file serving
app.get('/*', async (c) => {
  const requestPath = c.req.path === '/' ? '/index.html' : c.req.path;
  const filePath = path.join(spaDir, requestPath);

  // Try to serve the requested file
  const response = await serveStaticFile(filePath);
  if (response) return response;

  // Fallback to index.html for SPA routing
  const indexPath = path.join(spaDir, 'index.html');
  const indexResponse = await serveStaticFile(indexPath);
  if (indexResponse) return indexResponse;

  return c.text('Not Found', 404);
});

// Bunの--compileでビルドした場合、default exportがfetchプロパティを持つと自動的にBun.serveが呼ばれる
export default {
  port: process.env.PORT ? Number.parseInt(process.env.PORT) : 3000,
  fetch: app.fetch,
};
