// Servidor local sin dependencias: sirve la raíz del repo y emula el runtime de Vercel para /api/*.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/proxy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if (!(req.headers['content-type'] || '').includes('json')) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function serveApi(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  req.body = await readBody(req);
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  await handler(req, res);
}

async function serveStatic(res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  const file = resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
  const rel = relative(ROOT, file);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  // Nada de dotfiles ni carpetas ocultas (.git, .vercel, .superpowers, ...)
  if (rel.split(sep).some((segment) => segment.startsWith('.'))) {
    res.statusCode = 404;
    return res.end('Not found');
  }

  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await serveApi(req, res, url);
    else await serveStatic(res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.statusCode = 500;
    res.end('Internal error');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}`));
