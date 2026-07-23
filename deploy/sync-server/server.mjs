#!/usr/bin/env node
/**
 * Tiny Grove sync API — stores one JSON snapshot per sync key.
 * GET/PUT /api/sync/:key
 *
 * Env:
 *   PORT=8090
 *   DATA_DIR=/data
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = process.env.DATA_DIR || './data';

await fs.mkdir(DATA_DIR, { recursive: true });

function safeKey(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (key.length < 8 || key.length > 64) return null;
  return key;
}

function fileFor(key) {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return path.join(DATA_DIR, `${hash}.json`);
}

function send(res, status, body, extraHeaders = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    if (req.url === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    const match = /^\/api\/sync\/([^/?#]+)/.exec(req.url || '');
    if (!match) {
      send(res, 404, { error: 'Not found' });
      return;
    }

    const key = safeKey(decodeURIComponent(match[1]));
    if (!key) {
      send(res, 400, { error: 'Sync key must be 8–64 chars (letters, numbers, _ -).' });
      return;
    }

    const file = fileFor(key);

    if (req.method === 'GET') {
      try {
        const raw = await fs.readFile(file, 'utf8');
        send(res, 200, raw);
      } catch (err) {
        if (err && err.code === 'ENOENT') {
          send(res, 404, { error: 'No snapshot yet' });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.method === 'PUT') {
      const raw = await readBody(req);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        send(res, 400, { error: 'Body must be JSON' });
        return;
      }
      if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
        send(res, 400, { error: 'Expected { entries, quizQuestions?, updatedAt }' });
        return;
      }
      const snapshot = {
        updatedAt: Number(data.updatedAt) || Date.now(),
        entries: data.entries,
        quizQuestions: Array.isArray(data.quizQuestions) ? data.quizQuestions : [],
        quizRefreshMeta: data.quizRefreshMeta ?? null,
      };
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot), 'utf8');
      await fs.rename(tmp, file);
      send(res, 200, { ok: true, updatedAt: snapshot.updatedAt });
      return;
    }

    send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Grove sync listening on :${PORT} (data: ${DATA_DIR})`);
});
