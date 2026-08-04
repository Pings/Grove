/**
 * Cloze drills for measure words — full sentences with a blank for the 量词.
 */
export type MeasureWordCloze = {
  /** e.g. 我想看一___书 — learner picks 本 */
  prompt: string;
  english: string;
};

export const MEASURE_WORD_CLOZES: Record<string, MeasureWordCloze[]> = {
  个: [
    { prompt: '学校有一___新老师。', english: 'The school has a new teacher.' },
    { prompt: '这___学期很长。', english: 'This semester is long.' },
    { prompt: '我有两___好朋友。', english: 'I have two good friends.' },
    { prompt: '你要哪___？', english: 'Which one do you want?' },
  ],
  本: [
    { prompt: '我想买一___汉语书。', english: 'I want to buy a Chinese book.' },
    { prompt: '这___书很好看。', english: 'This book is interesting.' },
    { prompt: '桌子上有那___词典。', english: 'That dictionary is on the table.' },
  ],
  杯: [
    { prompt: '请给我一___茶。', english: 'Please give me a cup of tea.' },
    { prompt: '我想喝两___水。', english: 'I want to drink two glasses of water.' },
    { prompt: '这___咖啡多少钱？', english: 'How much is this cup of coffee?' },
  ],
  口: [
    { prompt: '我家有三___人。', english: 'There are three people in my family.' },
    { prompt: '他们家有四___人。', english: 'Their family has four people.' },
  ],
  只: [
    { prompt: '我养了一___猫。', english: 'I have a cat.' },
    { prompt: '公园里有两___狗。', english: 'There are two dogs in the park.' },
    { prompt: '树上有一___鸟。', english: 'There is a bird in the tree.' },
  ],
  两: [
    { prompt: '我买了___本书。', english: 'I bought two books.' },
    { prompt: '请给我___杯茶。', english: 'Please give me two cups of tea.' },
  ],
  块: [
    { prompt: '这本书十___钱。', english: 'This book is ten yuan.' },
    { prompt: '一共多少___？', english: 'How much is it altogether?' },
  ],
};

export function clozeForMeasureWord(hanzi: string): MeasureWordCloze | null {
  const key = hanzi.replace(/\s+/g, '').trim();
  const list = MEASURE_WORD_CLOZES[key];
  if (!list?.length) return null;
  return list[Math.floor(Math.random() * list.length)]!;
}
