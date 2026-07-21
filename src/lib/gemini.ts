import { GoogleGenerativeAI } from '@google/generative-ai';
import { TOPICS, type ComposeResult, type EnrichResult, type HskLevel, type Level3Feedback, type QuizLevel, type Topic } from '../types';
import { getApiKey, getGeminiModel } from './settings';
import { toPinyin } from './pinyin';

const TOPIC_LIST = TOPICS.join(', ');

function getModel() {
  const key = getApiKey();
  if (!key) {
    throw new Error('Add your Gemini API key in Settings first.');
  }
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: getGeminiModel(),
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

function friendlyError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('429') ||
    lower.includes('rate limit')
  ) {
    return new Error(
      `Free-tier quota hit for model “${getGeminiModel()}”. Wait a minute, or in Settings switch to “2.5 Flash Lite”. Daily free limits reset at midnight Pacific. Check usage: https://aistudio.google.com/usage`,
    );
  }

  if (lower.includes('api key') || lower.includes('401') || lower.includes('403')) {
    return new Error('API key rejected. Check the key in Settings / Google AI Studio.');
  }

  return err instanceof Error ? err : new Error(raw);
}

function normalizeHsk(value: unknown): HskLevel {
  if (value === 1 || value === 2 || value === 3) return value;
  if (value === '1' || value === '2' || value === '3') return Number(value) as 1 | 2 | 3;
  return 'unknown';
}

function normalizeTopics(value: unknown): Topic[] {
  if (!Array.isArray(value)) return ['Other'];
  const topics = value
    .map((t) => String(t).trim())
    .filter((t) => t.length > 0);
  return topics.length > 0 ? topics : ['Other'];
}

function normalizeType(value: unknown): EnrichResult['type'] {
  if (value === 'word' || value === 'phrase' || value === 'sentence') return value;
  return 'word';
}

export async function enrichInput(input: string): Promise<EnrichResult> {
  try {
    const model = getModel();
    const prompt = `You help a learner under HSK 3. Enrich this Chinese or English input into structured JSON.

Input: """${input}"""

Rules:
- Stay at or below HSK 3 vocabulary when possible.
- topics must be chosen from: ${TOPIC_LIST}
- type is word, phrase, or sentence
- hsk is 1, 2, 3, or "unknown"
- If input is a sentence, put full sentence in hanzi/english and split useful new words/short phrases into components (not every particle).
- If input is already a single word/phrase, components may be empty or include meaningful sub-parts.
- If the word is a measure word / 量词 (个, 本, 杯, 口, 只, 块, …), include topic "Measure Words".
- Prefer Simplified Chinese.
- notes: leave empty (grammar tips come from the library, not this step).

Return ONLY JSON:
{
  "hanzi": "...",
  "english": "...",
  "type": "word|phrase|sentence",
  "topics": ["Time"],
  "hsk": 1,
  "components": [{ "hanzi": "...", "english": "...", "type": "word", "topics": [], "hsk": 1, "notes": "" }],
  "notes": ""
}`;

    const result = await model.generateContent(prompt);
    const data = parseJson<EnrichResult>(result.response.text());

    return {
      hanzi: String(data.hanzi ?? '').trim(),
      english: String(data.english ?? '').trim(),
      type: normalizeType(data.type),
      topics: normalizeTopics(data.topics),
      hsk: normalizeHsk(data.hsk),
      notes: String(data.notes ?? '').trim(),
      components: Array.isArray(data.components)
        ? data.components
            .map((c) => ({
              hanzi: String(c.hanzi ?? '').trim(),
              english: String(c.english ?? '').trim(),
              type: normalizeType(c.type),
              topics: normalizeTopics(c.topics),
              hsk: normalizeHsk(c.hsk),
              notes: String(c.notes ?? '').trim(),
            }))
            .filter((c) => c.hanzi && c.english)
        : [],
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function composeWithLearned(
  input: string,
  learnedVocab: Array<{ hanzi: string; pinyin: string; english: string }>,
): Promise<ComposeResult> {
  try {
    const model = getModel();
    const vocabBlock = learnedVocab
      .slice(0, 400)
      .map((v) => `${v.hanzi} (${v.pinyin}) = ${v.english}`)
      .join('\n');

    const prompt = `You help an HSK 1–3 Chinese learner.

Learned vocabulary (prefer ONLY these when translating):
${vocabBlock || '(empty — learner has no learned words yet)'}

User input (Chinese or English): """${input}"""

Tasks:
1. Provide a natural translation / rewrite.
2. If translating TO Chinese, use learned vocab when possible.
3. List any words/phrases needed that are NOT clearly covered by the learned list.
4. topics from: ${TOPIC_LIST}
5. Keep under HSK 3.

Return ONLY JSON:
{
  "translation": "...",
  "usedOnlyLearned": true,
  "unknownWords": [
    { "hanzi": "...", "english": "...", "type": "word", "topics": ["Other"], "hsk": 1 }
  ],
  "notes": ""
}`;

    const result = await model.generateContent(prompt);
    const data = parseJson<ComposeResult>(result.response.text());

    return {
      translation: String(data.translation ?? '').trim(),
      usedOnlyLearned: Boolean(data.usedOnlyLearned),
      notes: String(data.notes ?? '').trim(),
      unknownWords: Array.isArray(data.unknownWords)
        ? data.unknownWords
            .map((w) => ({
              hanzi: String(w.hanzi ?? '').trim(),
              english: String(w.english ?? '').trim(),
              pinyin: toPinyin(String(w.hanzi ?? '')),
              type: normalizeType(w.type),
              topics: normalizeTopics(w.topics),
              hsk: normalizeHsk(w.hsk),
            }))
            .filter((w) => w.hanzi)
        : [],
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function generateSentenceExercise(
  learnedVocab: Array<{ hanzi: string; pinyin: string; english: string }>,
  level: 1 | 2 | 3,
  avoidHanzi: string[] = [],
): Promise<{ english: string; hanzi: string; blankHanzi: string[] }> {
  try {
    const model = getModel();
    const vocabBlock = learnedVocab
      .slice(0, 350)
      .map((v) => `${v.hanzi} (${v.pinyin}) = ${v.english}`)
      .join('\n');

    const blankRule =
      level === 1
        ? 'Pick 2 or 3 words from the vocab to blank out (blankHanzi array with 2–3 items). Prefer content words.'
        : 'blankHanzi should be an empty array — learner will type the full sentence.';

    const goal =
      level === 1
        ? 'Write a short sentence the learner completes by filling a few missing words.'
        : 'Write a NEW short sentence from their words/phrases — not a memorised stock line.';

    const avoidBlock =
      avoidHanzi.length > 0
        ? `\nDo NOT repeat or lightly paraphrase any of these recent practice sentences:\n${avoidHanzi
            .slice(-15)
            .map((h) => `- ${h}`)
            .join('\n')}\nWrite a clearly different sentence (different structure and vocab mix).`
        : '';

    const prompt = `You help an HSK 1–3 Chinese learner practice sentences.

Use ONLY vocabulary from this list when writing the Chinese sentence:
${vocabBlock || '(empty)'}

Difficulty level: ${level}
${goal}
${blankRule}
${avoidBlock}

Write a short natural sentence (HSK 1–3). The sentence must be composable entirely from the vocab list above.

Return ONLY JSON:
{
  "english": "English meaning of the sentence",
  "hanzi": "Full Chinese sentence",
  "blankHanzi": ["word1", "word2"]
}`;

    const result = await model.generateContent(prompt);
    const data = parseJson<{ english?: string; hanzi?: string; blankHanzi?: string[] }>(
      result.response.text(),
    );

    return {
      english: String(data.english ?? '').trim(),
      hanzi: String(data.hanzi ?? '').trim(),
      blankHanzi: Array.isArray(data.blankHanzi)
        ? data.blankHanzi.map((h) => String(h).trim()).filter(Boolean)
        : [],
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function regenerateQuizBank(
  vocab: Array<{
    hanzi: string;
    pinyin: string;
    english: string;
    hsk: HskLevel;
    type?: string;
    status?: string;
    avgSeconds?: number;
  }>,
  analysedHsk: HskLevel,
): Promise<
  Array<{
    english: string;
    hanzi: string;
    blankHanzi: string[];
    level: QuizLevel;
    hskHint: HskLevel;
    sourceVocab: string[];
  }>
> {
  try {
    const model = getModel();
    const vocabBlock = vocab
      .map(
        (v) =>
          `${v.hanzi} (${v.pinyin}) = ${v.english} [HSK ${v.hsk}${v.status ? `, ${v.status}` : ''}${v.avgSeconds != null ? `, ~${v.avgSeconds}s recall` : ''}]`,
      )
      .join('\n');

    const prompt = `You help an HSK 1–3 Chinese learner build a practice question bank.

Learner's estimated level: HSK ${analysedHsk === 'unknown' ? '1–2' : analysedHsk}

Vocabulary (use ONLY these words when composing Chinese sentences):
${vocabBlock || '(empty)'}

Generate 18 short natural Chinese sentences for practice. Exactly 6 per level:
- Level 1: fill a few words — blankHanzi has 2–3 items
- Level 2: also cloze practice — blankHanzi has 2–3 items (extra pool)
- Level 3: NEW full sentences from their vocab — blankHanzi is an empty array (learner types everything)

Rules:
- Each sentence must be composable from the vocab list above.
- Prefer words the learner is still learning.
- Stay at or below HSK 3.
- All 18 sentences must be distinct (no duplicates or near-duplicates).
- Never invent demo/placeholder words (nothing starting with 示范).
- sourceVocab: list of hanzi from the vocab used in that sentence.

Return ONLY JSON:
{
  "questions": [
    {
      "hanzi": "我喝茶。",
      "english": "I drink tea.",
      "level": 1,
      "hskHint": 1,
      "blankHanzi": ["喝", "茶"],
      "sourceVocab": ["我", "喝", "茶"]
    }
  ]
}`;

    const result = await model.generateContent(prompt);
    const data = parseJson<{
      questions?: Array<{
        hanzi?: string;
        english?: string;
        level?: unknown;
        hskHint?: unknown;
        blankHanzi?: string[];
        sourceVocab?: string[];
      }>;
    }>(result.response.text());

    if (!Array.isArray(data.questions)) return [];

    return data.questions
      .map((q) => {
        const levelNum = Number(q.level);
        const level: QuizLevel =
          levelNum === 1 || levelNum === 2 || levelNum === 3 ? levelNum : 1;
        return {
          hanzi: String(q.hanzi ?? '').trim(),
          english: String(q.english ?? '').trim(),
          level,
          hskHint: normalizeHsk(q.hskHint),
          blankHanzi: Array.isArray(q.blankHanzi)
            ? q.blankHanzi.map((h) => String(h).trim()).filter(Boolean)
            : [],
          sourceVocab: Array.isArray(q.sourceVocab)
            ? q.sourceVocab.map((h) => String(h).trim()).filter(Boolean)
            : [],
        };
      })
      .filter((q) => q.hanzi && q.english);
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function regenerateTeachingNote(entry: {
  hanzi: string;
  pinyin: string;
  english: string;
  type: string;
  topics: string[];
  kind: 'extra' | 'hanzi';
  currentNote: string;
  rating: -1 | 0 | 1;
  rejectedDetails: string[];
}): Promise<string> {
  try {
    const model = getModel();
    const liked =
      entry.rating === 1
        ? `Learner liked this vibe — new tip, same punch:\n"${entry.currentNote}"`
        : entry.rating === -1
          ? `Learner marked this bad — different angle:\n"${entry.currentNote}"`
          : entry.currentNote
            ? `Current tip (replace it):\n"${entry.currentNote}"`
            : 'No current tip.';

    const rejected =
      entry.rejectedDetails.length > 0
        ? `Never rewrite these rejected tips:\n${entry.rejectedDetails
            .slice(-12)
            .map((n) => `- ${n}`)
            .join('\n')}`
        : 'No rejected tips yet.';

    const focus =
      entry.kind === 'hanzi'
        ? `CHARACTER tip: name radicals/components with meaning, e.g. "木 (wood) + 不 (not) — wooden cup shape."
If nothing memorable about the shape, return an empty note.`
        : entry.type === 'sentence'
          ? `GRAMMAR tip for a full SENTENCE: one word-order, particle, or pattern trap (e.g. where 了 / 吗 / 在 sits). Never break down character radicals.`
          : `GRAMMAR tip: only if there's a real trap, slot, or contrast (两 vs 二, skip 吗, 很 as linker).
If the gloss already says everything useful, return an empty note. Never restate the English.`;

    const prompt = `One punchy sentence for an HSK 1–3 learner — or empty if nothing useful.

Card context (do NOT restate): ${entry.hanzi} (${entry.pinyin}) = ${entry.english}
Type: ${entry.type}; topics: ${entry.topics.join(', ') || 'Other'}

${focus}

Hard rules:
- Prefer EMPTY over filler. Vague lines like "learn as a chunk" or "hunt this shape" are forbidden.
- Max ~16 words if you write anything.
- Do NOT repeat ${entry.hanzi} as a gloss or “${entry.english}”.
- No example-sentence dumps. No waffle.
- Tips must be unique to THIS entry — not a generic template.

Tone: blunt, memorable.

${liked}

${rejected}

Return ONLY JSON: { "note": "..." }  (use "" if nothing useful)`;

    const result = await model.generateContent(prompt);
    const data = parseJson<{ note?: string; extraDetail?: string }>(result.response.text());
    const text = String(data.note ?? data.extraDetail ?? '').trim();
    return text;
  } catch (err) {
    throw friendlyError(err);
  }
}

/** Coach a Level 3 attempt that didn’t match the expected Chinese string. */
export async function reviewLevel3Attempt(input: {
  englishPrompt: string;
  expectedHanzi: string;
  userHanzi: string;
  knownVocab: Array<{ hanzi: string; english: string }>;
}): Promise<Level3Feedback> {
  try {
    const model = getModel();
    const vocabBlock = input.knownVocab
      .slice(0, 400)
      .map((v) => `${v.hanzi} = ${v.english}`)
      .join('\n');

    const prompt = `You coach an HSK 1–3 Chinese learner practicing sentence writing.

English prompt the learner should express: """${input.englishPrompt}"""
Expected model sentence: """${input.expectedHanzi}"""
Learner wrote: """${input.userHanzi}"""

Words already on their Shelf (do NOT list these as newWords):
${vocabBlock || '(none)'}

The learner’s Chinese does NOT match the model sentence character-for-character.

Decide:
1. meaningOk — true if their sentence still correctly and naturally expresses the English prompt (synonyms / different valid word order OK). false if wrong meaning, broken Chinese, or off-topic.
2. note — ONE short coaching note (max ~28 words):
   - If meaningOk: congratulate clearly (e.g. new vocabulary or a valid different structure). Mention the useful difference.
   - If not: explain the main mistake vs the English prompt / model sentence. Do not belittle.
3. newStructure — true only when meaningOk AND their pattern/structure differs usefully from the model.
4. newWords — useful NEW words/phrases they used correctly that are NOT clearly on the Shelf. Prefer content words (not 的/了/吗/是 alone). Empty if none. type is word or phrase (not sentence). Stay ≤ HSK 3. topics from: ${TOPIC_LIST}

Return ONLY JSON:
{
  "meaningOk": false,
  "note": "...",
  "newStructure": false,
  "newWords": [
    { "hanzi": "...", "english": "...", "type": "word", "topics": ["Other"], "hsk": 1 }
  ]
}`;

    const result = await model.generateContent(prompt);
    const data = parseJson<{
      meaningOk?: boolean;
      note?: string;
      newStructure?: boolean;
      newWords?: Array<{
        hanzi?: string;
        english?: string;
        type?: unknown;
        topics?: unknown;
        hsk?: unknown;
      }>;
    }>(result.response.text());

    const known = new Set(input.knownVocab.map((v) => v.hanzi.replace(/\s+/g, '')));
    const newWords = (Array.isArray(data.newWords) ? data.newWords : [])
      .map((w) => ({
        hanzi: String(w.hanzi ?? '').replace(/\s+/g, '').trim(),
        english: String(w.english ?? '').trim(),
        type: normalizeType(w.type) === 'sentence' ? ('word' as const) : normalizeType(w.type),
        topics: normalizeTopics(w.topics),
        hsk: normalizeHsk(w.hsk),
      }))
      .filter(
        (w) =>
          w.hanzi &&
          w.english &&
          w.type !== 'sentence' &&
          !known.has(w.hanzi) &&
          !/^示范/.test(w.hanzi),
      );

    return {
      meaningOk: Boolean(data.meaningOk),
      note:
        String(data.note ?? '').trim() ||
        (data.meaningOk
          ? 'Nice — that still works, even if it isn’t the model line.'
          : 'Not quite — compare your line with the model answer.'),
      newStructure: Boolean(data.newStructure) && Boolean(data.meaningOk),
      newWords,
    };
  } catch (err) {
    throw friendlyError(err);
  }
}

/** @deprecated Use regenerateTeachingNote */
export async function regenerateExtraDetail(entry: {
  hanzi: string;
  pinyin: string;
  english: string;
  type: string;
  topics: string[];
  extraDetail: string;
  extraDetailRating: -1 | 0 | 1;
  rejectedDetails: string[];
}): Promise<string> {
  return regenerateTeachingNote({
    hanzi: entry.hanzi,
    pinyin: entry.pinyin,
    english: entry.english,
    type: entry.type,
    topics: entry.topics,
    kind: 'extra',
    currentNote: entry.extraDetail,
    rating: entry.extraDetailRating,
    rejectedDetails: entry.rejectedDetails,
  });
}
