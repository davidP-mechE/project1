import { formatDay } from "@/lib/planning/dates";

/**
 * Small, dependency-free charts for the dashboard. Single series, one hue
 * (the primary token), thin bars with rounded tops on the baseline, values in
 * text colours, a hover tooltip per bar, and a hidden table for screen readers.
 */

export function MinutesChart({ days, goal }: { days: { day: string; minutes: number; active: boolean }[]; goal: number }) {
  const max = Math.max(goal, ...days.map((d) => d.minutes), 1);
  const goalPct = (goal / max) * 100;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">Minutes studied, last 14 days</figcaption>
      <div className="relative h-28" aria-hidden>
        {/* Goal line (recessive) */}
        <div className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${goalPct}%` }}>
          <span className="absolute -top-4 right-0 text-[10px] text-muted">goal {goal}m</span>
        </div>
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((d, i) => {
            const h = d.minutes > 0 ? Math.max(4, (d.minutes / max) * 100) : 0;
            const last = i === days.length - 1;
            return (
              <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center">
                {h > 0 ? (
                  <div
                    className="grow-up w-full max-w-5 rounded-t-[4px] transition-opacity group-hover:opacity-80"
                    style={{ height: `${h}%`, background: d.minutes >= goal ? "var(--primary)" : "color-mix(in oklab, var(--primary) 55%, var(--surface))", animationDelay: `${i * 25}ms` }}
                  />
                ) : (
                  <div className={`h-1 w-full max-w-5 rounded-full ${d.active ? "bg-primary/40" : "bg-surface-2"}`} />
                )}
                {/* Hover tooltip */}
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-text shadow-sm group-hover:block">
                  {formatDay(d.day)}: <strong>{d.minutes} min</strong>
                </div>
                {last && <span className="sr-only">today</span>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted" aria-hidden>
        <span>{formatDay(days[0].day, { month: "short", day: "numeric" })}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Minutes studied per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDay(d.day)}</th>
              <td>{d.minutes} minutes</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Today's goal as a ring around the minutes studied. */
export function GoalRing({ minutes, target, score }: { minutes: number; target: number; score?: { passed: boolean } }) {
  const pct = Math.min(1, minutes / Math.max(1, target));
  const r = 42;
  const c = 2 * Math.PI * r;
  const done = score ? score.passed : minutes >= target;
  const label = score ? `Score ${minutes}%` : `${minutes} of ${target} minutes studied today${done ? ", goal reached" : ""}`;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={done ? "var(--success)" : "var(--primary)"}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="ring-fill"
          style={{ ["--ring-from" as string]: `${c}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">
          {minutes}
          {score && <span className="text-base">%</span>}
        </span>
        <span className="text-xs text-muted">{score ? "score" : `of ${target} min`}</span>
      </div>
    </div>
  );
}

/** Average practice score per unit, as horizontal bars. */
export function UnitScores({ units }: { units: { id: string; title: string; score: number | null; answered: number; questions: number }[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {units.map((u) => (
        <li key={u.id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{u.title}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {u.score === null ? "not practised yet" : `${Math.round(u.score * 100)}%`}
              <span className="ml-1 text-xs">({u.answered}/{u.questions})</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {u.score !== null && <div className="grow-right h-full rounded-full bg-primary" style={{ width: `${Math.max(3, u.score * 100)}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
