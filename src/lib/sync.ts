import { db } from '../db/schema';
import {
  getLastSyncAt,
  getQuizRefreshMeta,
  getSyncKey,
  getSyncUrl,
  isSyncConfigured,
  setLastSyncAt,
  setQuizRefreshMeta,
  type GroveSnapshot,
} from './settings';
import { isGrowthDemoHanzi } from '../data/growthDemos';
import type { QuizQuestion, VocabEntry } from '../types';

let pushTimer: number | null = null;
let syncing = false;

function syncEndpoint(): string {
  const base = getSyncUrl();
  const key = encodeURIComponent(getSyncKey());
  return `${base}/api/sync/${key}`;
}

export async function buildLocalSnapshot(): Promise<GroveSnapshot> {
  const [entries, quizQuestions] = await Promise.all([
    db.entries.toArray(),
    db.quizQuestions.toArray(),
  ]);
  return {
    updatedAt: Date.now(),
    entries,
    quizQuestions,
    quizRefreshMeta: getQuizRefreshMeta(),
  };
}

async function applySnapshot(snapshot: GroveSnapshot): Promise<void> {
  const remoteEntries = snapshot.entries.filter((e) => !isGrowthDemoHanzi(e.hanzi));
  await db.transaction('rw', db.entries, db.quizQuestions, async () => {
    await db.entries.clear();
    const toAdd: Omit<VocabEntry, 'id'>[] = remoteEntries.map(({ id: _id, ...rest }) => rest);
    if (toAdd.length > 0) await db.entries.bulkAdd(toAdd);

    await db.quizQuestions.clear();
    const quizRows = (snapshot.quizQuestions || []).map(({ id: _id, ...rest }) => rest);
    if (quizRows.length > 0) await db.quizQuestions.bulkAdd(quizRows as Omit<QuizQuestion, 'id'>[]);
  });

  if (snapshot.quizRefreshMeta) {
    setQuizRefreshMeta(snapshot.quizRefreshMeta);
  }
  setLastSyncAt(snapshot.updatedAt || Date.now());
}

export async function pullRemoteSnapshot(): Promise<GroveSnapshot | null> {
  if (!isSyncConfigured()) return null;
  const res = await fetch(syncEndpoint(), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Sync pull failed (${res.status})`);
  }
  return (await res.json()) as GroveSnapshot;
}

export async function pushLocalSnapshot(snapshot?: GroveSnapshot): Promise<void> {
  if (!isSyncConfigured()) return;
  const payload = snapshot ?? (await buildLocalSnapshot());
  const res = await fetch(syncEndpoint(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Sync push failed (${res.status})`);
  }
  setLastSyncAt(payload.updatedAt);
}

/**
 * On boot: pull remote if newer / missing locally; otherwise push local up.
 * Last-write-wins by snapshot `updatedAt`.
 */
export async function syncOnBoot(): Promise<'pulled' | 'pushed' | 'skipped' | 'noop'> {
  if (!isSyncConfigured() || syncing) return 'noop';
  syncing = true;
  try {
    const remote = await pullRemoteSnapshot();
    const local = await buildLocalSnapshot();
    const last = getLastSyncAt() ?? 0;

    if (!remote) {
      await pushLocalSnapshot(local);
      return 'pushed';
    }

    const remoteAt = Number(remote.updatedAt) || 0;
    const localAt = Math.max(
      last,
      ...local.entries.map((e) => e.updatedAt || 0),
      ...local.quizQuestions.map((q) => q.createdAt || 0),
    );

    if (remoteAt >= localAt) {
      await applySnapshot(remote);
      return 'pulled';
    }

    await pushLocalSnapshot({ ...local, updatedAt: Date.now() });
    return 'pushed';
  } finally {
    syncing = false;
  }
}

/** Debounced push after local edits. */
export function scheduleSyncPush(delayMs = 1500): void {
  if (!isSyncConfigured()) return;
  if (pushTimer != null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushLocalSnapshot().catch((err) => {
      console.warn('Grove sync push failed:', err);
    });
  }, delayMs);
}

export async function testSyncConnection(): Promise<string> {
  if (!getSyncUrl()) throw new Error('Enter a sync server URL.');
  if (getSyncKey().length < 8) {
    throw new Error('Sync key must be at least 8 characters.');
  }
  const health = await fetch(`${getSyncUrl()}/health`);
  if (!health.ok) throw new Error(`Server not reachable (${health.status}).`);
  const remote = await pullRemoteSnapshot();
  if (!remote) return 'Connected — no remote snapshot yet (will upload on save).';
  return `Connected — remote has ${remote.entries?.length ?? 0} entries, updated ${new Date(remote.updatedAt).toLocaleString()}.`;
}
