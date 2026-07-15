import type { HskLevel, Topic } from '../types';

export function HskBadge({ hsk }: { hsk: HskLevel }) {
  const label = hsk === 'unknown' ? 'HSK ?' : `HSK ${hsk}`;
  const cls =
    hsk === 1
      ? 'badge-hsk1'
      : hsk === 2
        ? 'badge-hsk2'
        : hsk === 3
          ? 'badge-hsk3'
          : 'badge-unknown';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function TopicChips({
  topics,
  active,
  onToggle,
}: {
  topics: readonly string[] | string[];
  active?: Set<string>;
  onToggle?: (topic: Topic) => void;
}) {
  return (
    <div className="row">
      {topics.map((topic) => {
        const isActive = active?.has(topic);
        if (!onToggle) {
          return (
            <span key={topic} className="chip chip-static">
              {topic}
            </span>
          );
        }
        return (
          <button
            key={topic}
            type="button"
            className={`chip ${isActive ? 'active' : ''}`}
            onClick={() => onToggle(topic)}
          >
            {topic}
          </button>
        );
      })}
    </div>
  );
}
