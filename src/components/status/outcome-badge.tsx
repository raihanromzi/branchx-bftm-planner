import { CircleCheck, CirclePause, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";
import { PIPELINE_OUTCOME_LABELS, type PipelineOutcome } from "@/lib/validation";

const OUTCOME_STYLE = {
  won: { icon: CircleCheck, className: "bg-success/10 text-success" },
  lost: { icon: CircleX, className: "bg-danger/10 text-danger" },
  on_hold: { icon: CirclePause, className: "bg-warning/10 text-warning" },
} as const;

/**
 * The Outcome badge (DESIGN.md, Status display): a pill (the shape tells it from a Stage badge) with an
 * icon and the label "Berhasil", "Gagal" or "Ditunda", in the Outcome's status colour on a tint.
 */
export function OutcomeBadge({ outcome, className }: { outcome: PipelineOutcome; className?: string }) {
  const { icon: Icon, className: tone } = OUTCOME_STYLE[outcome];
  return (
    <span
      data-outcome={outcome}
      className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm leading-5 font-medium", tone, className)}
    >
      <Icon aria-hidden className="size-4" />
      {PIPELINE_OUTCOME_LABELS[outcome]}
    </span>
  );
}
