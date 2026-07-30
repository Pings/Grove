/**
 * Cloze drills for measure words — blank is where the 量词 goes.
 * English line is shown as a hint under the sentence.
 */
export type MeasureWordCloze = {
  /** e.g. 一___书 — learner picks 本 */
  prompt: string;
  english: string;
};

export const MEASURE_WORD_CLOZES: Record<string, MeasureWordCloze[]> = {
  个: [
    { prompt: '一___人', english: 'one person' },
    { prompt: '这___学期', english: 'this semester' },
    { prompt: '两___朋友', english: 'two friends' },
    { prompt: '哪___？', english: 'which one?' },
  ],
  本: [
    { prompt: '一___书', english: 'one book' },
    { prompt: '这___汉语书', english: 'this Chinese book' },
    { prompt: '那___词典', english: 'that dictionary' },
  ],
  杯: [
    { prompt: '一___茶', english: 'a cup of tea' },
    { prompt: '两___水', english: 'two glasses of water' },
    { prompt: '这___咖啡', english: 'this cup of coffee' },
  ],
  口: [
    { prompt: '三___人', english: 'a family of three' },
    { prompt: '家有四___人', english: 'there are four people in the family' },
  ],
  只: [
    { prompt: '一___猫', english: 'one cat' },
    { prompt: '两___狗', english: 'two dogs' },
    { prompt: '这___鸟', english: 'this bird' },
  ],
  两: [
    { prompt: '___本书', english: 'two books (before a measure word)' },
    { prompt: '___杯茶', english: 'two cups of tea' },
  ],
  块: [
    { prompt: '十___钱', english: 'ten kuai / yuan' },
    { prompt: '多少___？', english: 'how much (money)?' },
  ],
};

export function clozeForMeasureWord(hanzi: string): MeasureWordCloze | null {
  const key = hanzi.replace(/\s+/g, '').trim();
  const list = MEASURE_WORD_CLOZES[key];
  if (!list?.length) return null;
  return list[Math.floor(Math.random() * list.length)]!;
}
