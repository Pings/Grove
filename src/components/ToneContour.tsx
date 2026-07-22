/** Classic Chao-style pitch contours for Mandarin tones (1–5). */

type Props = {
  tones: number[];
  /** Compact for MC chips; larger for reveal. */
  size?: 'sm' | 'md';
  className?: string;
};

/** Pitch points on a 1–5 scale (Chao), left → right over the syllable. */
function contourPoints(tone: number): Array<[number, number]> {
  switch (tone) {
    case 1:
      return [
        [0, 5],
        [1, 5],
      ];
    case 2:
      return [
        [0, 3],
        [1, 5],
      ];
    case 3:
      return [
        [0, 2.2],
        [0.45, 1],
        [1, 4],
      ];
    case 4:
      return [
        [0, 5],
        [1, 1],
      ];
    case 5:
    default:
      return [
        [0.2, 2.5],
        [0.8, 2.5],
      ];
  }
}

function pathForTone(tone: number, w: number, h: number, pad: number): string {
  const pts = contourPoints(tone);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  // Pitch 5 at top, 1 at bottom
  const toXY = (t: number, pitch: number): [number, number] => [
    pad + t * innerW,
    pad + ((5 - pitch) / 4) * innerH,
  ];
  return pts
    .map((p, i) => {
      const [x, y] = toXY(p[0], p[1]);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function ToneContour({ tones, size = 'sm', className = '' }: Props) {
  const valid = tones.length > 0 ? tones : [5];
  const cellW = size === 'md' ? 72 : 48;
  const cellH = size === 'md' ? 40 : 28;
  const pad = size === 'md' ? 6 : 4;
  const stroke = size === 'md' ? 2.4 : 2;

  return (
    <span
      className={`tone-contour ${size === 'md' ? 'tone-contour-md' : ''} ${className}`.trim()}
      aria-hidden
    >
      {valid.map((tone, i) => (
        <svg
          key={`${tone}-${i}`}
          className="tone-contour-svg"
          width={cellW}
          height={cellH}
          viewBox={`0 0 ${cellW} ${cellH}`}
        >
          {/* faint staff lines */}
          {[1, 3, 5].map((pitch) => {
            const y = pad + ((5 - pitch) / 4) * (cellH - pad * 2);
            return (
              <line
                key={pitch}
                x1={pad}
                x2={cellW - pad}
                y1={y}
                y2={y}
                className="tone-contour-guide"
              />
            );
          })}
          <path
            d={pathForTone(tone, cellW, cellH, pad)}
            className={`tone-contour-stroke tone-${tone}`}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {tone === 5 && (
            <circle
              cx={cellW / 2}
              cy={pad + ((5 - 2.5) / 4) * (cellH - pad * 2)}
              r={size === 'md' ? 3.2 : 2.4}
              className="tone-contour-neutral"
            />
          )}
        </svg>
      ))}
    </span>
  );
}

/** Parse `tone-3` / `tone-2-3` option ids from the tone quiz. */
export function tonesFromOptionId(id: string): number[] | null {
  if (!id.startsWith('tone-')) return null;
  const parts = id
    .slice(5)
    .split('-')
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  return parts.length > 0 ? parts : null;
}
