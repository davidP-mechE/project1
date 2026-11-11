import Link from "next/link";

/** A compact "today" summary at the top of the library: streak, goal, cards due. Links to the dashboard. */
export function TodayStrip({ streak, minutes, goal, cards }: { streak: number; minutes: number; goal: number; cards: number }) {
  const pct = Math.min(100, Math.round((minutes / Math.max(1, goal)) * 100));
  return (
    <Link
      href="/dashboard"
      className="press-soft mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border-[1.5px] border-border bg-surface px-4 py-3 text-sm hover:border-text"
    >
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden className={streak > 0 ? "" : "grayscale"}>
          🔥
        </span>
        {streak > 0 ? `${streak}-day streak` : "Start a streak today"}
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-20 overflow-hidden bg-surface-2" aria-hidden>
          <span className="grow-right block h-full bg-primary" style={{ width: `${Math.max(pct, 4)}%` }} />
        </span>
        <span className="text-muted">
          {minutes}/{goal} min today
        </span>
      </span>
      {cards > 0 && <span className="text-muted">🃏 {cards} cards to review</span>}
      <span className="ml-auto font-semibold text-primary">Today</span>
    </Link>
  );
}
