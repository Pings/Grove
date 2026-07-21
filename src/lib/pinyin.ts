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

const VOWEL_TONE: Record<string, number> = {
  ā: 1,
  á: 2,
  ǎ: 3,
  à: 4,
  ē: 1,
  é: 2,
  ě: 3,
  è: 4,
  ī: 1,
  í: 2,
  ǐ: 3,
  ì: 4,
  ō: 1,
  ó: 2,
  ǒ: 3,
  ò: 4,
  ū: 1,
  ú: 2,
  ǔ: 3,
  ù: 4,
  ǖ: 1,
  ǘ: 2,
  ǚ: 3,
  ǜ: 4,
  Ā: 1,
  Á: 2,
  Ǎ: 3,
  À: 4,
  Ē: 1,
  É: 2,
  Ě: 3,
  È: 4,
  Ī: 1,
  Í: 2,
  Ǐ: 3,
  Ì: 4,
  Ō: 1,
  Ó: 2,
  Ǒ: 3,
  Ò: 4,
  Ū: 1,
  Ú: 2,
  Ǔ: 3,
  Ù: 4,
  Ǖ: 1,
  Ǘ: 2,
  Ǚ: 3,
  Ǜ: 4,
};

export const TONE_LABELS: Record<number, string> = {
  1: '1 · flat',
  2: '2 · rising',
  3: '3 · dipping',
  4: '4 · falling',
  5: '5 · neutral',
};

/** Extract citation tones (1–5) from tone-marked pinyin syllables. */
export function tonesFromPinyin(pinyinText: string): number[] {
  const syllables = pinyinText
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (syllables.length === 0) return [];

  return syllables.map((syl) => {
    for (const ch of syl) {
      if (VOWEL_TONE[ch] != null) return VOWEL_TONE[ch];
    }
    // Numeric tone suffix (e.g. ni3)
    const num = syl.match(/[1-5]/);
    if (num) return Number(num[0]);
    return 5;
  });
}

export function formatTonePattern(tones: number[]): string {
  return tones.join('-');
}

export function formatToneChoice(tones: number[]): { primary: string; secondary: string } {
  const pattern = formatTonePattern(tones);
  if (tones.length === 1) {
    return { primary: TONE_LABELS[tones[0]] ?? pattern, secondary: `tone ${tones[0]}` };
  }
  return {
    primary: pattern,
    secondary: tones.map((t) => TONE_LABELS[t]?.split(' · ')[1] ?? String(t)).join(' · '),
  };
}

/**
 * Third-tone sandhi: consecutive citation 3rd tones → first spoken as 2nd.
 * Returns spoken tones plus a short learner note when sandhi applies.
 */
export function thirdToneSandhi(tones: number[]): {
  spoken: number[];
  note: string | null;
} {
  const spoken = [...tones];
  const pairs: number[] = [];
  for (let i = 0; i < spoken.length - 1; i += 1) {
    if (tones[i] === 3 && tones[i + 1] === 3) {
      spoken[i] = 2;
      pairs.push(i);
    }
  }
  if (pairs.length === 0) {
    return { spoken, note: null };
  }
  const citation = formatTonePattern(tones);
  const spokenPat = formatTonePattern(spoken);
  return {
    spoken,
    note: `Two 3rd tones in a row: citation ${citation}, spoken ${spokenPat} (first 3 → 2). Classic: 你好 nǐ hǎo → ní hǎo.`,
  };
}

/** Build plausible wrong tone patterns for multiple choice. */
export function toneDistractors(correct: number[], count: number): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>([formatTonePattern(correct)]);

  const push = (tones: number[]) => {
    const key = formatTonePattern(tones);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tones);
  };

  // Flip one syllable at a time through 1–4 (and 5 for short words).
  for (let i = 0; i < correct.length && out.length < count * 3; i += 1) {
    for (const t of [1, 2, 3, 4, 5]) {
      if (t === correct[i]) continue;
      if (correct.length > 1 && t === 5 && i < correct.length - 1) continue;
      const next = [...correct];
      next[i] = t;
      push(next);
    }
  }

  // Shuffle and take `count`
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, count);
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
