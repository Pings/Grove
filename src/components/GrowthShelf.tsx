import { useEffect, useMemo, useState } from 'react';
import type { VocabEntry } from '../types';
import {
  growthStage,
  needsWatering,
  pickShelfSlice,
  topGrowthCohort,
  growthLabel,
} from '../lib/growth';
import { EntryPlantBadge, PlantCanopy } from './PlantGrowth';

type Props = {
  entries: VocabEntry[];
  thresholdMs: number;
  onSelect: (entry: VocabEntry) => void;
};

const SHELF_SIZE = 5;
const CYCLE_MS = 4500;

export function GrowthShelf({ entries, thresholdMs, onSelect }: Props) {
  const [salt, setSalt] = useState(0);

  const cohort = useMemo(
    () => topGrowthCohort(entries.filter((e) => e.type !== 'sentence'), thresholdMs),
    [entries, thresholdMs],
  );

  const stage = cohort[0] ? growthStage(cohort[0], thresholdMs) : 0;

  useEffect(() => {
    if (cohort.length <= SHELF_SIZE) return;
    const id = window.setInterval(() => setSalt((s) => s + 1), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [cohort.length]);

  const shown = useMemo(
    () => pickShelfSlice(cohort, SHELF_SIZE, salt),
    [cohort, salt],
  );

  if (shown.length === 0) return null;

  return (
    <section className="growth-shelf panel" aria-label="Most grown cards">
      <div className="growth-shelf-header">
        <strong>Top shelf</strong>
        <span className="muted">
          {growthLabel(stage)} · cycling strongest growth
        </span>
      </div>
      <div className="growth-shelf-row">
        {shown.map((entry) => {
          const s = growthStage(entry, thresholdMs);
          const wilted = needsWatering(entry);
          return (
            <button
              key={entry.id}
              type="button"
              className={`growth-shelf-card ${s >= 5 ? 'is-canopy' : ''} ${wilted ? 'needs-water' : ''}`}
              onClick={() => onSelect(entry)}
            >
              {s >= 5 && <PlantCanopy stage={s} wilted={wilted} />}
              <EntryPlantBadge entry={entry} stage={s} thresholdMs={thresholdMs} />
              <div className="growth-shelf-copy">
                <div className="hanzi">{entry.hanzi}</div>
                <div className="pinyin">{entry.pinyin}</div>
                {wilted && <div className="needs-water-label">Needs water</div>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
