import type { GrowthStage, PlantVariant } from '../lib/growth';
import {
  growthEmoji,
  growthLabel,
  growthStage,
  needsWatering,
  plantVariantFor,
} from '../lib/growth';
import type { VocabEntry } from '../types';

type MarkProps = {
  stage: GrowthStage;
  wilted?: boolean;
  /** Reserved for your image pack later */
  variant?: PlantVariant;
  size?: number;
  className?: string;
};

/**
 * Growth mark. Emoji for now — swap the inside for <img> when you send assets.
 * Keep stage + wilted (+ variant) as the public API.
 */
export function PlantMark({
  stage,
  wilted = false,
  variant: _variant = 'default',
  size = 36,
  className = '',
}: MarkProps) {
  const emoji = growthEmoji(stage, wilted);
  const label = wilted
    ? `${growthLabel(stage)} · needs watering`
    : growthLabel(stage);

  return (
    <span
      className={`plant-mark ${wilted ? 'is-wilted' : ''} ${className}`}
      style={{ fontSize: size * 0.72, width: size, height: size }}
      role="img"
      aria-label={label}
      title={label}
      data-stage={stage}
      data-wilted={wilted ? '1' : '0'}
      data-variant={_variant}
    >
      {emoji}
    </span>
  );
}

/** Slot for full-card leaf art when learned — empty until you add images. */
export function PlantCanopy({
  stage = 5,
  wilted = false,
  className = '',
}: {
  stage?: GrowthStage;
  wilted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`plant-canopy ${wilted ? 'is-wilted' : ''} ${className}`}
      data-stage={stage}
      data-wilted={wilted ? '1' : '0'}
      aria-hidden
    />
  );
}

export function EntryPlantBadge({
  entry,
  stage,
  thresholdMs,
}: {
  entry: VocabEntry;
  stage?: GrowthStage;
  thresholdMs: number;
}) {
  const resolved = stage ?? growthStage(entry, thresholdMs);
  const wilted = needsWatering(entry);
  const variant = plantVariantFor(entry);
  return <PlantMark stage={resolved} wilted={wilted} variant={variant} size={34} />;
}
