/** Sticky reference digits for Count practice. */
export const CORE_DIGITS: Array<{ n: number; hanzi: string; pinyin: string }> = [
  { n: 0, hanzi: '零', pinyin: 'líng' },
  { n: 1, hanzi: '一', pinyin: 'yī' },
  { n: 2, hanzi: '二', pinyin: 'èr' },
  { n: 3, hanzi: '三', pinyin: 'sān' },
  { n: 4, hanzi: '四', pinyin: 'sì' },
  { n: 5, hanzi: '五', pinyin: 'wǔ' },
  { n: 6, hanzi: '六', pinyin: 'liù' },
  { n: 7, hanzi: '七', pinyin: 'qī' },
  { n: 8, hanzi: '八', pinyin: 'bā' },
  { n: 9, hanzi: '九', pinyin: 'jiǔ' },
  { n: 10, hanzi: '十', pinyin: 'shí' },
];

const DIGIT_CHARS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** Phone-style reading: 1 → 幺 (common on the mainland for clarity). */
const PHONE_DIGIT_CHARS = ['零', '幺', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

export type CountMode = 'digits' | 'dates' | 'times' | 'dayparts' | 'phone';

export type CountPrompt = {
  id: string;
  mode: CountMode;
  /** Shown to the learner (English / Arabic). */
  prompt: string;
  /** Accepted Chinese answers (normalized punctuation stripped for compare). */
  answers: string[];
  /** Preferred display answer. */
  reveal: string;
  hint?: string;
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export function normalizeCountAnswer(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[。．.！!？?，,、]/g, '')
    .replace(/日/g, '号')
    .trim();
}

/** Integer 0–999 → Chinese (HSK-style, no 两). */
export function numberToHanzi(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999 || !Number.isInteger(n)) {
    throw new Error('numberToHanzi supports integers 0–999');
  }
  if (n < 10) return DIGIT_CHARS[n]!;
  if (n === 10) return '十';
  if (n < 20) return `十${DIGIT_CHARS[n % 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones === 0 ? `${DIGIT_CHARS[tens]}十` : `${DIGIT_CHARS[tens]}十${DIGIT_CHARS[ones]}`;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return `${DIGIT_CHARS[hundreds]}百`;
  if (rest < 10) return `${DIGIT_CHARS[hundreds]}百零${DIGIT_CHARS[rest]}`;
  return `${DIGIT_CHARS[hundreds]}百${numberToHanzi(rest)}`;
}

export function digitsToHanzi(digits: string, phoneStyle = false): string {
  const table = phoneStyle ? PHONE_DIGIT_CHARS : DIGIT_CHARS;
  return [...digits]
    .map((ch) => {
      if (ch === '-' || ch === ' ') return '';
      const d = Number(ch);
      if (Number.isNaN(d) || d < 0 || d > 9) return ch;
      return table[d]!;
    })
    .join('');
}

export function formatDateHanzi(month: number, day: number): string {
  return `${numberToHanzi(month)}月${numberToHanzi(day)}号`;
}

/** Clock time → Chinese. Uses 点 / 分 / 半. */
export function formatTimeHanzi(hour: number, minute: number): string {
  const h = numberToHanzi(hour);
  if (minute === 0) return `${h}点`;
  if (minute === 30) return `${h}点半`;
  return `${h}点${numberToHanzi(minute)}分`;
}

const WEEKDAYS: Array<{ en: string; zh: string }> = [
  { en: 'Monday', zh: '星期一' },
  { en: 'Tuesday', zh: '星期二' },
  { en: 'Wednesday', zh: '星期三' },
  { en: 'Thursday', zh: '星期四' },
  { en: 'Friday', zh: '星期五' },
  { en: 'Saturday', zh: '星期六' },
  { en: 'Sunday', zh: '星期天' },
];

function makeDigitPrompt(): CountPrompt {
  const n = randInt(0, 99);
  const zh = numberToHanzi(n);
  return {
    id: `digit-${n}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'digits',
    prompt: String(n),
    answers: [zh],
    reveal: zh,
    hint: 'Write the number in Chinese characters',
  };
}

function makeDatePrompt(): CountPrompt {
  const roll = Math.random();

  // Years (digit-by-digit reading)
  if (roll < 0.28) {
    return makeYearPrompt();
  }

  // Full date with year: 2024年5月7号
  if (roll < 0.48) {
    const year = randInt(1990, 2026);
    const month = randInt(1, 12);
    const day = randInt(1, month === 2 ? 28 : 30);
    const yearZh = digitsToHanzi(String(year), false);
    const zh = `${yearZh}年${formatDateHanzi(month, day)}`;
    const alt = zh.replace(/号$/, '日');
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return {
      id: `fulldate-${year}-${month}-${day}`,
      mode: 'dates',
      prompt: `${months[month - 1]} ${day}, ${year}`,
      answers: [zh, alt],
      reveal: zh,
      hint: '…年…月…号',
    };
  }

  if (roll < 0.68) {
    const day = pick(WEEKDAYS);
    return {
      id: `weekday-${day.en}-${Math.random().toString(36).slice(2, 7)}`,
      mode: 'dates',
      prompt: day.en,
      answers: day.en === 'Sunday' ? ['星期天', '星期日'] : [day.zh],
      reveal: day.zh,
      hint: 'Weekday',
    };
  }

  const month = randInt(1, 12);
  const day = randInt(1, month === 2 ? 28 : 30);
  const zh = formatDateHanzi(month, day);
  const alt = zh.replace(/号$/, '日');
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return {
    id: `date-${month}-${day}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'dates',
    prompt: `${months[month - 1]} ${day}`,
    answers: [zh, alt],
    reveal: zh,
    hint: '…月…号',
  };
}

function makeTimePrompt(): CountPrompt {
  const hour = randInt(1, 12);
  const minuteChoices = [0, 5, 10, 15, 20, 30, 45];
  const minute = pick(minuteChoices);
  const zh = formatTimeHanzi(hour, minute);
  const answers = [zh];
  if (minute === 30) answers.push(`${numberToHanzi(hour)}点三十分`);
  if (minute === 0) answers.push(`${numberToHanzi(hour)}点零分`, `${numberToHanzi(hour)}点整`);
  const mm = String(minute).padStart(2, '0');
  return {
    id: `time-${hour}-${minute}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'times',
    prompt: `${hour}:${mm}`,
    answers,
    reveal: zh,
    hint: '…点…分 / 半',
  };
}

/** Parts of the day + clock times with 早上/上午/下午/晚上. */
const DAY_PARTS: Array<{
  en: string;
  zh: string;
  alts?: string[];
  /** Clock hours this part usually covers (1–12 dial). */
  hours?: number[];
}> = [
  { en: 'early morning', zh: '早上', alts: ['早晨'], hours: [5, 6, 7, 8] },
  { en: 'morning', zh: '上午', hours: [8, 9, 10, 11] },
  { en: 'noon', zh: '中午', hours: [12] },
  { en: 'afternoon', zh: '下午', hours: [1, 2, 3, 4, 5, 6] },
  { en: 'evening', zh: '晚上', hours: [6, 7, 8, 9, 10] },
  { en: 'night / late night', zh: '夜里', alts: ['夜晚'], hours: [10, 11, 12] },
  { en: 'midnight', zh: '半夜', alts: ['午夜'] },
];

function makeDaypartPrompt(): CountPrompt {
  // Pure vocabulary ~40%
  if (Math.random() < 0.4) {
    const part = pick(DAY_PARTS);
    return {
      id: `daypart-${part.zh}-${Math.random().toString(36).slice(2, 7)}`,
      mode: 'dayparts',
      prompt: part.en,
      answers: [part.zh, ...(part.alts ?? [])],
      reveal: part.zh,
      hint: 'Time of day',
    };
  }

  // Combined: afternoon 3:30 → 下午三点半
  const part = pick(DAY_PARTS.filter((p) => p.hours && p.hours.length > 0));
  const hour = pick(part.hours!);
  const minute = pick([0, 15, 30, 45]);
  const clockZh = formatTimeHanzi(hour, minute);
  const zh = `${part.zh}${clockZh}`;
  const answers = [zh];
  if (part.alts) {
    for (const alt of part.alts) answers.push(`${alt}${clockZh}`);
  }
  // Accept clock-only as wrong? No — require the day part for this mode.
  // Also accept 上午/早上 swap for overlapping morning hours when prompt says morning-ish.
  if (part.zh === '早上') answers.push(`上午${clockZh}`);
  if (part.zh === '上午' && hour <= 8) answers.push(`早上${clockZh}`);

  const mm = String(minute).padStart(2, '0');
  return {
    id: `daypart-time-${part.zh}-${hour}-${minute}-${Math.random().toString(36).slice(2, 7)}`,
    mode: 'dayparts',
    prompt: `${part.en} · ${hour}:${mm}`,
    answers,
    reveal: zh,
    hint: '早上/上午/下午/晚上 + …点…',
  };
}

function makePhonePrompt(): CountPrompt {
  const len = pick([7, 8, 11] as const);
  let digits = '';
  for (let i = 0; i < len; i += 1) digits += String(randInt(0, 9));
  // Avoid all-zeros
  if (/^0+$/.test(digits)) digits = `02${digits.slice(2)}`;
  const withYao = digitsToHanzi(digits, true);
  const withYi = digitsToHanzi(digits, false);
  const spaced =
    len === 11
      ? `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
      : len === 8
        ? `${digits.slice(0, 4)}-${digits.slice(4)}`
        : digits;
  return {
    id: `phone-${digits}`,
    mode: 'phone',
    prompt: spaced,
    answers: [withYao, withYi],
    reveal: withYao,
    hint: 'Read digit by digit (1 can be 幺 or 一)',
  };
}

function makeYearPrompt(): CountPrompt {
  const year = randInt(1990, 2026);
  const digits = String(year);
  const byDigit = digitsToHanzi(digits, false);
  const answers = [byDigit];
  if (year >= 2000 && year <= 2009) {
    answers.push(`二千零${DIGIT_CHARS[year % 10]}`);
  } else if (year >= 2010 && year <= 2026) {
    const rest = year - 2000;
    answers.push(`二千${numberToHanzi(rest)}`);
  }
  return {
    id: `year-${year}`,
    mode: 'dates',
    prompt: String(year),
    answers,
    reveal: byDigit,
    hint: 'Years are usually read digit by digit',
  };
}

export function makeCountPrompt(mode: CountMode): CountPrompt {
  switch (mode) {
    case 'digits':
      return makeDigitPrompt();
    case 'dates':
      return makeDatePrompt();
    case 'times':
      return makeTimePrompt();
    case 'dayparts':
      return makeDaypartPrompt();
    case 'phone':
      return makePhonePrompt();
  }
}

export function checkCountAnswer(prompt: CountPrompt, input: string): boolean {
  const got = normalizeCountAnswer(input);
  return prompt.answers.some((a) => normalizeCountAnswer(a) === got);
}

/** Distractors near the correct Chinese string for MC practice. */
export function buildCountChoices(prompt: CountPrompt, count = 4): string[] {
  const correct = prompt.reveal;
  const pool = new Set<string>([correct]);
  let guard = 0;
  while (pool.size < count && guard < 40) {
    guard += 1;
    const alt = makeCountPrompt(prompt.mode).reveal;
    pool.add(alt);
  }
  while (pool.size < count) {
    pool.add(numberToHanzi(randInt(0, 99)));
  }
  return shuffle([...pool]).slice(0, count);
}
