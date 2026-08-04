import type { VocabEntry } from '../types';

/**
 * Legacy growth-stage demo cards (示范…).
 * No longer seeded. removeGrowthDemos() deletes leftover 示范* rows on boot.
 */
export const GROWTH_DEMO_ENTRIES: Array<
  Omit<VocabEntry, 'id' | 'createdAt' | 'updatedAt' | 'nextReviewAt'> & {
    demoStage: 0 | 1 | 2 | 3 | 4 | 5;
  }
> = [];

export const GROWTH_DEMO_HANZI = new Set(GROWTH_DEMO_ENTRIES.map((e) => e.hanzi));

/** @deprecated wilted demos no longer used */
export const WILTED_DEMO_HANZI = new Set<string>();

export function isGrowthDemoHanzi(hanzi: string): boolean {
  const key = hanzi.replace(/\s+/g, '').trim();
  if (GROWTH_DEMO_HANZI.has(key)) return true;
  return key.startsWith('示范');
}

export function isGrowthDemoEntry(entry: { hanzi: string }): boolean {
  return isGrowthDemoHanzi(entry.hanzi);
}
