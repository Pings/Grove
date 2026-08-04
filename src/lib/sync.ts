import { clearLibraryData, db } from '../db/schema';
import {
  getActiveProfileId,
  getApiBase,
  getQuizRefreshMeta,
  scrubLegacyBrowserStorage,
  setActiveProfileId,
  setQuizRefreshMeta,
  type GroveSnapshot,
  type SyncProfile,
} from './settings';
import { isGrowthDemoHanzi } from '../data/growthDemos';
import type { QuizQuestion, VocabEntry } from '../types';

let pushTimer: number | null = null;
let syncing = false;
let activeSyncKey: string | null = null;
let profilesCache: SyncProfile[] = [];
let lastServerAt: number | null = null;

export function getCachedProfiles(): SyncProfile[] {
  return profilesCache;
}

export function getActiveSyncKey(): string | null {
  return activeSyncKey;
}

export function getLastServerAt(): number | null {
  return lastServerAt;
}

function apiUrl(path: string): string {
  const base = getApiBase().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function syncEndpoint(key = activeSyncKey): string {
  if (!key) throw new Error('No active profile.');
  return apiUrl(`/api/sync/${encodeURIComponent(key)}`);
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

  setQuizRefreshMeta(snapshot.quizRefreshMeta ?? null);
  lastServerAt = snapshot.updatedAt || Date.now();
}

export async function fetchProfiles(): Promise<SyncProfile[]> {
  const res = await fetch(apiUrl('/api/profiles'));
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Could not load profiles (${res.status})`);
  }
  const data = (await res.json()) as { profiles?: SyncProfile[] };
  profilesCache = Array.isArray(data.profiles) ? data.profiles : [];
  return profilesCache;
}

export async function createRemoteProfile(name: string): Promise<{
  profile: SyncProfile;
  profiles: SyncProfile[];
}> {
  const res = await fetch(apiUrl('/api/profiles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    profile?: SyncProfile;
    profiles?: SyncProfile[];
  } | null;
  if (!res.ok || !body?.profile) {
    throw new Error(body?.error || `Could not create profile (${res.status})`);
  }
  profilesCache = Array.isArray(body.profiles) ? body.profiles : [...profilesCache, body.profile];
  return { profile: body.profile, profiles: profilesCache };
}

export async function deleteRemoteProfile(id: string): Promise<SyncProfile[]> {
  const res = await fetch(apiUrl(`/api/profiles/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    profiles?: SyncProfile[];
  } | null;
  if (!res.ok) {
    throw new Error(body?.error || `Could not delete profile (${res.status})`);
  }
  profilesCache = Array.isArray(body?.profiles) ? body!.profiles : profilesCache.filter((p) => p.id !== id);
  return profilesCache;
}

export async function pullRemoteSnapshot(key = activeSyncKey): Promise<GroveSnapshot | null> {
  if (!key) return null;
  const res = await fetch(syncEndpoint(key), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Library pull failed (${res.status})`);
  }
  return (await res.json()) as GroveSnapshot;
}

export async function pushLocalSnapshot(snapshot?: GroveSnapshot): Promise<void> {
  if (!activeSyncKey) return;
  const payload = snapshot ?? (await buildLocalSnapshot());
  const res = await fetch(syncEndpoint(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Library save failed (${res.status})`);
  }
  lastServerAt = payload.updatedAt;
}

/**
 * Boot: scrub browser word-DB leftovers, load profiles from the Grove server,
 * pull the active profile (default Nikko). Server is source of truth.
 */
export async function loadLibraryFromServer(): Promise<'pulled' | 'empty'> {
  if (syncing) return 'empty';
  syncing = true;
  try {
    // Capture any pre-update IndexedDB library before we treat the server as source of truth.
    const browserSnapshot = await buildLocalSnapshot();
    const browserHasWords = browserSnapshot.entries.length > 0;

    const { legacySyncKey } = scrubLegacyBrowserStorage();
    const profiles = await fetchProfiles();
    if (profiles.length === 0) {
      throw new Error('Server returned no profiles.');
    }

    const preferredId = getActiveProfileId();
    const active =
      profiles.find((p) => p.id === preferredId) ??
      profiles.find((p) => p.id === 'nikko' || p.name === 'Nikko') ??
      profiles[0]!;

    setActiveProfileId(active.id);
    activeSyncKey = active.syncKey;

    let remote = await pullRemoteSnapshot(active.syncKey);
    const remoteEmpty = !remote || !remote.entries?.length;
    const isNikko = active.id === 'nikko' || active.name === 'Nikko';

    // One-time: empty Nikko ← old sync-key snapshot on the same server
    if (
      isNikko &&
      remoteEmpty &&
      legacySyncKey &&
      legacySyncKey !== active.syncKey
    ) {
      const legacySnap = await pullRemoteSnapshot(legacySyncKey);
      if (legacySnap?.entries?.length) {
        await pushLocalSnapshot({ ...legacySnap, updatedAt: Date.now() });
        remote = legacySnap;
      }
    }

    // One-time: empty Nikko ← this browser’s previous IndexedDB-only library
    if (isNikko && (!remote || !remote.entries?.length) && browserHasWords) {
      await pushLocalSnapshot({
        ...browserSnapshot,
        updatedAt: Date.now(),
      });
      await clearLibraryData();
      setQuizRefreshMeta(null);
      await applySnapshot({
        ...browserSnapshot,
        updatedAt: Date.now(),
      });
      return 'pulled';
    }

    await clearLibraryData();
    setQuizRefreshMeta(null);

    if (remote) {
      await applySnapshot(remote);
      return remote.entries?.length ? 'pulled' : 'empty';
    }

    await pushLocalSnapshot({
      updatedAt: Date.now(),
      entries: [],
      quizQuestions: [],
      quizRefreshMeta: null,
    });
    return 'empty';
  } finally {
    syncing = false;
  }
}

/** Debounced push after local edits — always saves to the active server profile. */
export function scheduleSyncPush(delayMs = 800): void {
  if (!activeSyncKey || syncing) return;
  if (pushTimer != null) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    if (syncing) return;
    void pushLocalSnapshot().catch((err) => {
      console.warn('Grove library save failed:', err);
    });
  }, delayMs);
}

export async function reloadActiveProfile(): Promise<'pulled' | 'empty'> {
  if (!activeSyncKey) return loadLibraryFromServer();
  await clearLibraryData();
  setQuizRefreshMeta(null);
  const remote = await pullRemoteSnapshot();
  if (remote) {
    await applySnapshot(remote);
    return 'pulled';
  }
  return 'empty';
}

/**
 * Switch profile: save current to server, then load the other profile’s DB (or empty).
 */
export async function switchSyncProfile(
  profile: SyncProfile,
  options: { pushCurrent?: boolean } = {},
): Promise<'pulled' | 'empty'> {
  if (profile.syncKey.length < 8) throw new Error('Profile key is invalid.');

  if (options.pushCurrent !== false && activeSyncKey) {
    try {
      await pushLocalSnapshot();
    } catch (err) {
      console.warn('Could not save before profile switch:', err);
    }
  }

  setActiveProfileId(profile.id);
  activeSyncKey = profile.syncKey;
  lastServerAt = null;

  await clearLibraryData();
  setQuizRefreshMeta(null);

  const remote = await pullRemoteSnapshot();
  if (remote) {
    await applySnapshot(remote);
    return remote.entries?.length ? 'pulled' : 'empty';
  }

  await pushLocalSnapshot({
    updatedAt: Date.now(),
    entries: [],
    quizQuestions: [],
    quizRefreshMeta: null,
  });
  return 'empty';
}

export async function testServerConnection(): Promise<string> {
  const health = await fetch(apiUrl('/health'));
  if (!health.ok) throw new Error(`Server not reachable (${health.status}).`);
  const profiles = await fetchProfiles();
  const active = profiles.find((p) => p.id === getActiveProfileId()) ?? profiles[0];
  if (!active) return 'Connected — no profiles yet.';
  const remote = await pullRemoteSnapshot(active.syncKey);
  if (!remote) {
    return `Connected — profile “${active.name}” is empty.`;
  }
  return `Connected — “${active.name}” has ${remote.entries?.length ?? 0} entries.`;
}

/** @deprecated use testServerConnection */
export const testSyncConnection = testServerConnection;

/** @deprecated use loadLibraryFromServer */
export async function syncOnBoot(): Promise<'pulled' | 'pushed' | 'skipped' | 'noop'> {
  const result = await loadLibraryFromServer();
  return result === 'pulled' ? 'pulled' : 'pushed';
}
