import { Card } from "@/components/ui/misc";
import { usageMeters, type PlanLimits, type Usage } from "@/lib/usage/limits";
import { cn } from "@/lib/utils";

/** Settings → "Plan and usage": how much of this month's allowance is used. */
export function UsageMeter({ plan, limits, usage, resetsAt }: { plan: string; limits: PlanLimits; usage: Usage; resetsAt: Date }) {
  const meters = usageMeters(usage, limits);
  const reset = resetsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Plan and usage</h2>
        <span className="rounded bg-surface-2 px-2.5 py-0.5 text-sm font-medium">{plan === "PRO" ? "Pro" : "Free"} plan</span>
      </div>
      <ul className="flex flex-col gap-4">
        {meters.map((m) => {
          const pct = Math.round(m.fraction * 100);
          return (
            <li key={m.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{m.label}</span>
                <span className="tabular-nums text-muted">{m.text}</span>
              </div>
              <div
                role="progressbar"
                aria-label={m.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={m.text}
                className="h-2 overflow-hidden rounded-full bg-surface-2"
              >
                <div
                  className={cn("h-full rounded-full", m.fraction >= 1 ? "bg-danger" : m.fraction >= 0.8 ? "bg-warning" : "bg-primary")}
                  style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Monthly allowances reset on {reset}. Multiple choice answers, flashcards, search and downloads are always free. AI usage is what Claude
        costs for writing lessons and tests, checking written answers, and the tutor.
      </p>
    </Card>
  );
}
