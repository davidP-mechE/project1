import { formatDay } from "@/lib/planning/dates";

/**
 * Small, dependency-free charts for the dashboard. Single series, one hue
 * (the primary token), thin bars with rounded tops on the baseline, values in
 * text colours, a hover tooltip per bar, and a hidden table for screen readers.
 */

/**
 * Minutes studied over the last 14 days: rounded columns that grow in, today
 * in gold, the daily goal as a labelled line, day initials underneath, and a
 * one-line summary. Days with no study show a small stub so the rhythm is
 * still visible.
 */
export function MinutesChart({ days, goal }: { days: { day: string; minutes: number; active: boolean }[]; goal: number }) {
  const max = Math.max(goal * 1.25, ...days.map((d) => d.minutes), 1);
  const goalPct = (goal / max) * 100;
  const week = days.slice(-7).reduce((n, d) => n + d.minutes, 0);
  const hit = days.filter((d) => d.minutes >= goal).length;
  const best = days.reduce((b, d) => (d.minutes > b.minutes ? d : b), days[0]);
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption className="text-sm font-medium">Minutes studied, last 14 days</figcaption>
        <p className="text-xs text-muted">
          <span className="score-num text-base text-text">{week}</span> min this week · <span className="font-semibold text-accent-ink">┈ daily goal {goal} min</span> met {hit} of 14 days
          {best.minutes > 0 && ` · best: ${formatDay(best.day, { weekday: "short" })}`}
        </p>
      </div>
      <div className="relative h-36" aria-hidden>
        <div className="absolute inset-x-0 z-10 border-t-2 border-dotted border-accent/70" style={{ bottom: `${goalPct}%` }} />
        <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const h = d.minutes > 0 ? Math.max(6, (d.minutes / max) * 100) : 0;
            return (
              <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center">
                {h > 0 ? (
                  <div
                    className="grow-up w-full max-w-7 rounded-t-lg rounded-b-sm transition-[filter] group-hover:brightness-110"
                    style={{ height: `${h}%`, background: today ? "var(--accent)" : d.minutes >= goal ? "var(--chart-1)" : "color-mix(in oklab, var(--chart-1) 45%, var(--surface))", animationDelay: `${i * 35}ms` }}
                  />
                ) : (
                  <div className={`h-1.5 w-full max-w-7 rounded-full ${today ? "bg-accent/50" : "bg-surface-2"}`} />
                )}
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs text-text shadow-sm group-hover:block">
                  {formatDay(d.day)}: <strong>{d.minutes} min</strong>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1.5 text-center text-[10px] text-muted sm:gap-2" aria-hidden>
        {days.map((d, i) => (
          <span key={d.day} className={`flex-1 ${i === days.length - 1 ? "font-bold text-accent-ink" : ""}`}>
            {i === days.length - 1 ? "Today" : formatDay(d.day, { weekday: "narrow" })}
          </span>
        ))}
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

/** A small progress ring (quests, tiles): `value` 0–1. */
export function MiniRing({ value, done, label }: { value: number; done?: boolean; label: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-11 shrink-0 -rotate-90" role="img" aria-label={label}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="4" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={done ? "var(--success)" : "var(--accent)"} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} className="ring-fill" style={{ ["--ring-from" as string]: `${c}` }} />
    </svg>
  );
}

/** Today's goal as a ring around the minutes studied. */
export function GoalRing({ minutes, target, score, onDark = false }: { minutes: number; target: number; score?: { passed: boolean }; onDark?: boolean }) {
  const pct = Math.min(1, minutes / Math.max(1, target));
  const r = 42;
  const c = 2 * Math.PI * r;
  const done = score ? score.passed : minutes >= target;
  const label = score ? `Score ${minutes}%` : `${minutes} of ${target} minutes studied today${done ? ", goal reached" : ""}`;
  return (
    <div className={onDark ? "relative size-36 shrink-0 sm:size-40" : "relative size-28 shrink-0"} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        {onDark &&
          Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * 2 * Math.PI;
            return <line key={i} x1={50 + 47 * Math.cos(a)} y1={50 + 47 * Math.sin(a)} x2={50 + (i % 6 === 0 ? 43 : 45) * Math.cos(a)} y2={50 + (i % 6 === 0 ? 43 : 45) * Math.sin(a)} stroke="rgb(255 255 255 / 0.4)" strokeWidth="1" />;
          })}
        <circle cx="50" cy="50" r={onDark ? 36 : r} fill="none" stroke={onDark ? "rgb(255 255 255 / 0.2)" : "var(--surface-2)"} strokeWidth={onDark ? 7 : 9} />
        <circle
          cx="50"
          cy="50"
          r={onDark ? 36 : r}
          fill="none"
          stroke={done ? (onDark ? "#ff5c93" : "var(--success)") : onDark ? "#ffffff" : "var(--primary)"}
          strokeWidth={onDark ? 7 : 9}
          strokeLinecap="butt"
          strokeDasharray={onDark ? 2 * Math.PI * 36 : c}
          strokeDashoffset={(onDark ? 2 * Math.PI * 36 : c) * (1 - Math.max(pct, minutes > 0 ? 0.02 : 0))}
          className="ring-fill"
          style={{ ["--ring-from" as string]: `${onDark ? 2 * Math.PI * 36 : c}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={onDark ? "score-num text-4xl" : "text-2xl font-semibold tabular-nums"}>
          {minutes}
          {score && <span className="text-base">%</span>}
        </span>
        <span className={onDark ? "text-xs opacity-75" : "text-xs text-muted"}>{score ? "score" : `of ${target} min today`}</span>
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
