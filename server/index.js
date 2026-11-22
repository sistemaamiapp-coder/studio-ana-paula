// Servidor local: publica os arquivos de public/ e roda a API da função edge
// (functions/routes.mjs) com banco e storage em memória.
// Uso: node server/index.js  (PORT=3000 por padrão)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { application } from '../functions/routes.mjs';
import { createFakeDb } from '../dev/fake-db.mjs';
import { createFakeStorage } from '../dev/fake-storage.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const API_BASE = '/functions/v1/app';

const db = createFakeDb();
const storage = createFakeStorage();

const liveSockets = new Set();
const liveServer = new WebSocketServer({ noServer: true });

function broadcastLive(event) {
  const data = JSON.stringify(event);
  for (const socket of liveSockets) {
    if (socket.readyState === socket.OPEN) socket.send(data);
  }
}

const handle = application({ db, storage, live: broadcastLive });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function toWebRequest(request, body) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : body
  });
}

async function sendWebResponse(response, res) {
  const headers = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Requisição inválida');
    return;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.startsWith('..')) {
    res.writeHead(403).end('Acesso negado');
    return;
  }
  const candidates = [];
  if (!relative || relative.endsWith('/')) candidates.push(join(relative, 'index.html'));
  else {
    candidates.push(relative);
    if (!extname(relative)) candidates.push(`${relative}.html`);
  }

  for (const candidate of candidates) {
    const file = join(publicDir, candidate);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      let body = await readFile(file);
      const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
      if (type.startsWith('text/html')) {
        body = Buffer.from(body.toString('utf8').replace('</head>', `  <script>window.__API_BASE=${JSON.stringify(API_BASE)};</script>\n</head>`));
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
      return;
    } catch { /* tenta o próximo candidato */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Página não encontrada');
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  const upload = url.pathname.match(/^\/functions\/v1\/app\/__upload\/(.+)$/);
  if (upload && request.method === 'PUT') {
    const objectPath = decodeURIComponent(upload[1]);
    if (!/^portfolio\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(objectPath)) {
      response.writeHead(400).end('invalid path');
      return;
    }
    const bytes = new Uint8Array(await readBody(request));
    await storage.upload(objectPath, bytes, { contentType: request.headers['content-type'] || 'application/octet-stream' });
    response.writeHead(200).end();
    return;
  }

  if (url.pathname.startsWith(API_BASE)) {
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
      const webRequest = await toWebRequest(request, body);
      await sendWebResponse(await handle(webRequest), response);
    } catch (error) {
      console.error('[api] erro inesperado', error);
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Erro inesperado no servidor.' }));
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

async function liveAdmin(request) {
  const cookie = request.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)aps_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const sessions = (await db.from('sessions').select('user_id,expires_at').eq('token', token).limit(1)).data || [];
  const session = sessions[0];
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const users = (await db.from('users').select('id,role').eq('id', session.user_id).limit(1)).data || [];
  return users[0]?.role === 'admin' ? users[0] : null;
}

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname !== '/api/live' && url.pathname !== `${API_BASE}/api/live`) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!(await liveAdmin(request))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  liveServer.handleUpgrade(request, socket, head, ws => {
    liveSockets.add(ws);
    ws.on('close', () => liveSockets.delete(ws));
    ws.on('error', () => liveSockets.delete(ws));
    ws.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
  });
});

server.listen(port, () => {
  console.log(`Studio Ana Paula Souza em http://127.0.0.1:${port}`);
});
