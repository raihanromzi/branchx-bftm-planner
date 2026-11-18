// The Stage colour bucket and accessible label (DESIGN.md, Status display). Pure, so the list, the
// Pipeline screen and the map markers share one rule.

/** Number of colour steps (`--stage-1` to `--stage-5`). */
export const STAGE_BUCKETS = 5;

/**
 * The colour bucket of a Stage: `ceil(position / stageCount × 5)`, from 1 to 5. `position` is 1-based.
 * Out-of-range input (position below 1 or above stageCount, or no Stages) is clamped into 1 to 5.
 */
export function stageBucket(position: number, stageCount: number): 1 | 2 | 3 | 4 | 5 {
  if (!(stageCount >= 1) || !(position >= 1)) return 1;
  // Multiply first, so the division is exact whenever the result is a whole number (no 3.0000000000000004).
  const raw = Math.ceil((Math.min(position, stageCount) * STAGE_BUCKETS) / stageCount);
  return Math.min(STAGE_BUCKETS, Math.max(1, raw)) as 1 | 2 | 3 | 4 | 5;
}

/** "Presentasi, tahap 3 dari 5": the Stage badge's accessible name. */
export function stageLabel(stageName: string, position: number, stageCount: number): string {
  return `${stageName}, tahap ${position} dari ${stageCount}`;
}
