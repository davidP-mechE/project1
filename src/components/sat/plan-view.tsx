import { domainName } from "@/lib/sat/domains";
import type { PlanWeek } from "@/lib/sat/practice";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The week-by-week plan to test day. It's rebuilt from the latest results every time. */
export function PlanView({ weeks, testDate }: { weeks: PlanWeek[]; testDate: Date }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {weeks.length} {weeks.length === 1 ? "week" : "weeks"} to your SAT on {day(testDate)}. Weakest topics come first, and the plan updates as your results change.
      </p>
      <ol className="flex flex-col divide-y divide-border">
        {weeks.map((w, i) => (
          <li key={i} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[9rem_1fr]">
            <span className="font-medium tabular-nums">
              {i === 0 ? "This week" : `Week ${i + 1}`}
              <span className="block text-xs font-normal text-muted">
                {day(w.start)}–{day(w.end)}
              </span>
            </span>
            <span className="flex flex-col gap-1">
              {w.finalReview ? (
                <span>Final review: your mistake log, then rest before test day.</span>
              ) : (
                <span>Focus: {w.focus.map((f) => domainName(f)).join(" and ")}</span>
              )}
              {w.checkpoint && <span className="text-primary">Take a full practice test (Bluebook) and add the score.</span>}
              {w.assignments.map((a) => (
                <span key={a.title + a.dueAt.toISOString()} className="text-muted">
                  Due {day(a.dueAt)}: {a.title}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
