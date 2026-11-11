import { SKILL_STATUS_LABEL, type SkillStats } from "@/lib/mastery/review";
import { cn } from "@/lib/utils";

const TONE: Record<SkillStats["status"], string> = {
  new: "bg-surface-2 text-muted",
  shaky: "bg-danger-bg text-danger",
  improving: "bg-warning-bg text-warning",
  hammered: "bg-success-bg text-success",
};

export function SkillBadge({ status }: { status: SkillStats["status"] }) {
  return <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold", TONE[status])}>{SKILL_STATUS_LABEL[status]}</span>;
}
