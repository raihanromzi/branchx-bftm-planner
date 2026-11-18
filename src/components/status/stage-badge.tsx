import { stageBucket, stageLabel } from "@/lib/stage";
import { cn } from "@/lib/utils";

// Static class names per bucket, so Tailwind sees every one of them.
const BUCKET_CLASS = {
  1: "bg-stage-1 text-stage-1-foreground",
  2: "bg-stage-2 text-stage-2-foreground",
  3: "bg-stage-3 text-stage-3-foreground",
  4: "bg-stage-4 text-stage-4-foreground",
  5: "bg-stage-5 text-stage-5-foreground",
} as const;

/**
 * The Stage badge (DESIGN.md, Status display): a position mark of filled and empty dots, then the Stage
 * name, on the colour of the Stage's bucket (`ceil(position / stageCount × 5)`). The badge's accessible
 * name is "Presentasi, tahap 3 dari 5"; the dots and the visible name are hidden from assistive tech.
 *
 * The name is never truncated (EC45): it never shrinks below its longest word and wraps inside the
 * badge rather than being cut, so a 12-character name such as "Pembukaan Rekening" is always whole.
 */
export function StageBadge({
  stageName,
  position,
  stageCount,
  className,
}: {
  stageName: string;
  position: number;
  stageCount: number;
  className?: string;
}) {
  const bucket = stageBucket(position, stageCount);
  return (
    <span
      role="img"
      aria-label={stageLabel(stageName, position, stageCount)}
      data-stage-bucket={bucket}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5 text-sm leading-5 font-medium",
        BUCKET_CLASS[bucket],
        className,
      )}
    >
      <span aria-hidden className="flex shrink-0 items-center gap-0.5">
        {Array.from({ length: Math.max(stageCount, 1) }, (_, index) => (
          <span
            key={index}
            className={cn(
              "size-1.5 rounded-full border border-current",
              index < position ? "bg-current" : "bg-transparent",
            )}
          />
        ))}
      </span>
      <span aria-hidden data-slot="stage-name" className="min-w-0 break-words whitespace-normal">
        {stageName}
      </span>
    </span>
  );
}
