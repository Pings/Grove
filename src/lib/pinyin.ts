import { pinyin } from 'pinyin-pro';

export function toPinyin(hanzi: string): string {
  if (!hanzi.trim()) return '';
  return pinyin(hanzi, {
    toneType: 'symbol',
    type: 'array',
    nonZh: 'consecutive',
  })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasHanzi(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** Strip tone marks and spaces so "mingtian" matches "míngtiān". */
export function normalizePinyinSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining accents
    .replace(/[·ʼ'`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

export function matchesSearch(
  entry: { hanzi: string; pinyin: string; english: string; notes: string },
  rawQuery: string,
): boolean {
  const q = rawQuery.trim();
  if (!q) return true;

  // Hanzi: direct substring
  if (entry.hanzi.includes(q)) return true;

  const qLower = q.toLowerCase();
  if (entry.english.toLowerCase().includes(qLower)) return true;
  if (entry.notes.toLowerCase().includes(qLower)) return true;

  // Pinyin with or without tones / spaces: "mingtian" | "ming tian" | "míngtiān"
  const qPy = normalizePinyinSearch(q);
  if (!qPy) return false;
  return normalizePinyinSearch(entry.pinyin).includes(qPy);
}

function hanziKey(hanzi: string): string {
  return hanzi.replace(/\s+/g, '');
}

/** Phrase/sentence only when the full entry matches the typed text. */
export function isPerfectEntryMatch(
  entry: { hanzi: string; pinyin: string; english: string },
  rawText: string,
): boolean {
  const q = rawText.trim();
  if (!q) return false;

  if (entry.hanzi && q.includes(entry.hanzi)) return true;

  const qLower = q.toLowerCase();
  const eng = entry.english.toLowerCase().trim();
  if (eng && qLower === eng) return true;

  const qPy = normalizePinyinSearch(q);
  const entryPy = normalizePinyinSearch(entry.pinyin);
  if (qPy && entryPy && qPy === entryPy) return true;

  return false;
}

/**
 * Live matches for Compose: words by partial match; phrases/sentences only on perfect match.
 */
export function findRelatedEntries<
  T extends { hanzi: string; pinyin: string; english: string; notes: string; type: string },
>(entries: T[], text: string, limit = 24): T[] {
  const q = text.trim();
  if (!q) return [];

  const qLower = q.toLowerCase();
  const tokens = q
    .split(/[\s,，。.!?;；、:：]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const lastToken = tokens[tokens.length - 1] ?? '';

  const scored: { entry: T; score: number }[] = [];

  for (const entry of entries) {
    const isWord = entry.type === 'word';
    const perfect = isPerfectEntryMatch(entry, q);

    if (!isWord && !perfect) continue;

    let score = 0;
    const hanzi = entry.hanzi;
    const eng = entry.english.toLowerCase();
    const py = normalizePinyinSearch(entry.pinyin);

    if (perfect && !isWord) {
      score += 30;
    }

    // Entry appears inside the typed text (great for Chinese sentences)
    if (hanzi.length > 0 && q.includes(hanzi)) {
      score += 20 + Math.min(hanzi.length, 8);
    }

    // English phrase/word appears in typed text
    if (eng.length > 1 && qLower.includes(eng)) {
      score += 16 + Math.min(eng.length, 10);
    }

    // Whole-query library search (partial typing) — words only
    if (isWord && matchesSearch(entry, q)) {
      score += 8;
    }

    // Last token — what you're currently typing
    if (isWord && lastToken.length >= 1) {
      if (matchesSearch(entry, lastToken)) score += 14;
      if (hanzi.includes(lastToken)) score += 10;
      const lastPy = normalizePinyinSearch(lastToken);
      if (lastPy && py.includes(lastPy)) score += 12;
    }

    // Any english/pinyin token overlap — words only
    if (isWord) {
      for (const token of tokens) {
        if (token === lastToken) continue;
        const tLower = token.toLowerCase();
        if (eng === tLower || eng.includes(tLower) || tLower.includes(eng)) {
          if (tLower.length >= 2) score += 6;
        }
        const tPy = normalizePinyinSearch(token);
        if (tPy.length >= 2 && (py.includes(tPy) || tPy.includes(py))) score += 6;
        if (hanzi.includes(token)) score += 8;
      }
    }

    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.hanzi.length - b.entry.hanzi.length);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const { entry } of scored) {
    const key = hanziKey(entry.hanzi);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}
