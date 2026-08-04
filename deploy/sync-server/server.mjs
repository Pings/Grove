#!/usr/bin/env node
/**
 * Grove library API — profiles + one JSON snapshot per profile key.
 *
 *   GET/POST          /api/profiles
 *   DELETE            /api/profiles/:id
 *   GET/PUT           /api/sync/:key
 *   GET               /health
 *
 * Env:
 *   PORT=8090
 *   DATA_DIR=/data
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = process.env.DATA_DIR || './data';
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const NIKKO_ID = 'nikko';
const NIKKO_KEY = 'grove-nikko';
/** Older single-key installs may have used these. */
const LEGACY_SYNC_KEYS = ['grove', 'grove-default'];

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

function slugify(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'profile';
}

function makeSyncKey(name) {
  const slug = slugify(name);
  const rand = randomBytes(4).toString('hex');
  return `grove-${slug}-${rand}`.slice(0, 64);
}

function send(res, status, body, extraHeaders = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
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

async function readJsonFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJsonFile(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, file);
}

async function readSnapshot(key) {
  return readJsonFile(fileFor(key));
}

async function writeSnapshot(key, snapshot) {
  await writeJsonFile(fileFor(key), snapshot);
}

async function migrateLegacyIntoNikko() {
  const nikkoFile = fileFor(NIKKO_KEY);
  const existing = await readJsonFile(nikkoFile);
  if (existing && Array.isArray(existing.entries) && existing.entries.length > 0) {
    return;
  }
  for (const legacy of LEGACY_SYNC_KEYS) {
    const snap = await readSnapshot(legacy);
    if (snap && Array.isArray(snap.entries) && snap.entries.length > 0) {
      await writeSnapshot(NIKKO_KEY, {
        ...snap,
        updatedAt: Number(snap.updatedAt) || Date.now(),
      });
      return;
    }
  }
}

async function loadProfiles() {
  let data = await readJsonFile(PROFILES_FILE);
  if (!data || !Array.isArray(data.profiles) || data.profiles.length === 0) {
    await migrateLegacyIntoNikko();
    data = {
      profiles: [
        {
          id: NIKKO_ID,
          name: 'Nikko',
          syncKey: NIKKO_KEY,
          createdAt: Date.now(),
        },
      ],
    };
    await writeJsonFile(PROFILES_FILE, data);
    const empty = await readSnapshot(NIKKO_KEY);
    if (!empty) {
      await writeSnapshot(NIKKO_KEY, {
        updatedAt: Date.now(),
        entries: [],
        quizQuestions: [],
        quizRefreshMeta: null,
      });
    }
    return data.profiles;
  }

  // Ensure Nikko always exists
  if (!data.profiles.some((p) => p.id === NIKKO_ID || p.name === 'Nikko')) {
    data.profiles.unshift({
      id: NIKKO_ID,
      name: 'Nikko',
      syncKey: NIKKO_KEY,
      createdAt: Date.now(),
    });
    await writeJsonFile(PROFILES_FILE, data);
    await migrateLegacyIntoNikko();
  }

  return data.profiles;
}

async function saveProfiles(profiles) {
  await writeJsonFile(PROFILES_FILE, { profiles });
}

function emptySnapshot() {
  return {
    updatedAt: Date.now(),
    entries: [],
    quizQuestions: [],
    quizRefreshMeta: null,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/profiles') {
      if (req.method === 'GET') {
        const profiles = await loadProfiles();
        send(res, 200, { profiles });
        return;
      }

      if (req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          send(res, 400, { error: 'Body must be JSON' });
          return;
        }
        const name = String(body?.name || '').trim();
        if (!name) {
          send(res, 400, { error: 'Profile name is required' });
          return;
        }
        if (name.toLowerCase() === 'nikko') {
          send(res, 400, { error: 'Profile “Nikko” already exists' });
          return;
        }

        const profiles = await loadProfiles();
        if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
          send(res, 409, { error: 'That profile name already exists' });
          return;
        }

        const syncKey = makeSyncKey(name);
        const profile = {
          id: randomBytes(8).toString('hex'),
          name,
          syncKey,
          createdAt: Date.now(),
        };
        profiles.push(profile);
        await saveProfiles(profiles);
        await writeSnapshot(syncKey, emptySnapshot());
        send(res, 201, { profile, profiles });
        return;
      }

      send(res, 405, { error: 'Method not allowed' });
      return;
    }

    const deleteMatch = /^\/api\/profiles\/([^/?#]+)$/.exec(pathname);
    if (deleteMatch) {
      if (req.method !== 'DELETE') {
        send(res, 405, { error: 'Method not allowed' });
        return;
      }
      const id = decodeURIComponent(deleteMatch[1]);
      const profiles = await loadProfiles();
      const target = profiles.find((p) => p.id === id);
      if (!target) {
        send(res, 404, { error: 'Profile not found' });
        return;
      }
      if (target.id === NIKKO_ID || target.name === 'Nikko') {
        send(res, 400, { error: 'Cannot delete the Nikko profile' });
        return;
      }
      if (profiles.length <= 1) {
        send(res, 400, { error: 'Keep at least one profile' });
        return;
      }
      const next = profiles.filter((p) => p.id !== id);
      await saveProfiles(next);
      send(res, 200, { ok: true, profiles: next });
      return;
    }

    const syncMatch = /^\/api\/sync\/([^/?#]+)$/.exec(pathname);
    if (!syncMatch) {
      send(res, 404, { error: 'Not found' });
      return;
    }

    const key = safeKey(decodeURIComponent(syncMatch[1]));
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
      await writeJsonFile(file, snapshot);
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
