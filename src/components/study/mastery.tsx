import { LEVEL_LABEL, type MasteryLevel } from "@/lib/mastery/mastery";
import { cn } from "@/lib/utils";

const TONE: Record<MasteryLevel, string> = {
  new: "bg-surface-2 text-muted",
  learning: "bg-warning-bg text-warning",
  familiar: "bg-primary/12 text-primary",
  mastered: "bg-success-bg text-success",
};
const DOTS: Record<MasteryLevel, number> = { new: 0, learning: 1, familiar: 2, mastered: 3 };

/** A small pill: ●●○ Familiar. */
export function MasteryBadge({ level, className }: { level: MasteryLevel; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", TONE[level], className)}>
      <span aria-hidden className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("size-1.5 rounded-full", i < DOTS[level] ? "bg-current" : "bg-current opacity-25")} />
        ))}
      </span>
      {LEVEL_LABEL[level]}
    </span>
  );
}
