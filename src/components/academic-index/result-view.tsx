import { COMPONENT_LABELS, DISCLAIMER, ESSAY_CRITERIA, type ComponentKey } from "@/lib/academic-index/config";
import type { GradedEssay, ResultDetail } from "@/server/academic-index";
import { cn } from "@/lib/utils";

/** Pieces of the results page (spec section 8). Shared with the tutor's view of a shared index. */

export const COMPONENT_ORDER: ComponentKey[] = ["test", "gpa", "rigor", "activities", "essays"];
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");

/** The big score with its tier badge, estimate tags, and the disclaimer directly under it. */
export function ScoreHero({ total, tier, tierMessage, labels, size = "lg" }: { total: number; tier: string; tierMessage: string; labels: string[]; size?: "lg" | "sm" }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className={cn("font-display font-extrabold leading-none tracking-tight tabular-nums", size === "lg" ? "text-7xl" : "text-5xl")}>
          {total}
          <span className="sr-only"> out of 230, {tier}</span>
          <span aria-hidden className="ml-1 text-xl font-semibold text-muted">/ 230</span>
        </p>
        <p aria-hidden className="mb-1 rounded-md bg-text px-3 py-1 text-sm font-bold text-bg">
          {total} · {tier}
        </p>
      </div>
      {labels.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Estimate">
          {labels.map((l) => (
            <li key={l} className="rounded-md border-[1.5px] border-warning/40 bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning">
              {l}
            </li>
          ))}
        </ul>
      )}
      <p className="text-base">{tierMessage}</p>
      <Disclaimer />
    </div>
  );
}

export function Disclaimer() {
  return <p className="max-w-2xl border-l-4 border-accent pl-3 text-sm text-muted">{DISCLAIMER}</p>;
}

/** Five bars, one per component: earned / max. */
export function ComponentBars({ components }: { components: ResultDetail["components"] }) {
  return (
    <ul className="flex flex-col gap-4">
      {COMPONENT_ORDER.map((k) => {
        const c = components[k];
        const pct = c.present ? (c.earned / c.max) * 100 : 0;
        return (
          <li key={k} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{COMPONENT_LABELS[k]}</span>
              <span className="tabular-nums text-muted">{c.present ? `${fmt(c.earned)} / ${c.max}` : k === "test" ? "Test-optional" : "Pending"}</span>
            </div>
            <div
              role="meter"
              aria-label={COMPONENT_LABELS[k]}
              aria-valuemin={0}
              aria-valuemax={c.max}
              aria-valuenow={c.present ? Math.round(c.earned * 10) / 10 : 0}
              aria-valuetext={c.present ? `${fmt(c.earned)} of ${c.max}` : "Not included"}
              className="h-3 w-full overflow-hidden rounded-sm bg-surface-2"
            >
              <div className={cn("h-full", c.present ? "bg-primary" : "")} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The biggest-lever tip: the one realistic step that would add the most. */
export function LeverTip({ levers }: { levers: ResultDetail["levers"] }) {
  if (levers.length === 0) return <p className="text-sm text-muted">Every part is at or near its maximum. Nice work.</p>;
  const [top, ...rest] = levers;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold">
        {top.step}: <span className="text-success">+{fmt(top.gain)} points</span>
      </p>
      {rest.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Other steps</summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {rest.map((l) => (
              <li key={l.component}>
                {COMPONENT_LABELS[l.component]}: {l.step} (+{fmt(l.gain)})
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EssayCard({ title, essay }: { title: string; essay: GradedEssay }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border-[1.5px] border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-sm tabular-nums">
          <strong>{essay.score}</strong> / 25 · {essay.wordCount} words{essay.limit ? ` (limit ${essay.limit})` : ""}
        </span>
      </div>
      {essay.prompt && <p className="text-sm text-muted">Prompt: {essay.prompt}</p>}
      {essay.warnings.map((w) => (
        <p key={w} className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning">
          {w}
        </p>
      ))}
      <dl className="flex flex-col divide-y divide-border">
        {ESSAY_CRITERIA.map((c) => (
          <div key={c.key} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
            <dt className="text-sm font-semibold">
              {c.label} <span className="tabular-nums">{essay.criteria[c.key]}/5</span>
            </dt>
            <dd className="flex flex-col gap-1 text-sm">
              {essay.feedback[c.key].evidence && <q className="italic text-muted">{essay.feedback[c.key].evidence}</q>}
              <span>{essay.feedback[c.key].suggestion}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Each essay's five criterion scores, an evidence quote and one suggestion each. */
export function EssayFeedback({ essays }: { essays: { grader: "claude" | "demo" | null; personalStatement: GradedEssay | null; supplements: GradedEssay[] } }) {
  if (!essays.personalStatement) return null;
  return (
    <div className="flex flex-col gap-4">
      {essays.grader === "demo" && <p className="text-sm text-muted">Demo mode: these scores are placeholders, not a real reading.</p>}
      <p className="text-sm text-muted">Feedback only: revise in your own words. Each essay was read three times and the middle score kept for each criterion.</p>
      <EssayCard title="Personal statement" essay={essays.personalStatement} />
      {essays.supplements.map((s, n) => (
        <EssayCard key={n} title={`Supplement ${n + 1}`} essay={s} />
      ))}
    </div>
  );
}

/** Past scores, so students see progress. A table follows for screen readers. */
export function HistoryChart({ points, zone }: { points: { total: number; createdAt: Date }[]; zone: string }) {
  if (points.length < 2) return null;
  const W = 640, H = 220, P = { l: 40, r: 16, t: 16, b: 28 };
  const lo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.total)) - 20) / 20) * 20);
  const hi = Math.min(230, Math.ceil((Math.max(...points.map((p) => p.total)) + 20) / 20) * 20);
  const x = (i: number) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: zone });
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 20) ticks.push(v);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Academic Index history: ${points.map((p) => `${p.total} on ${date(p.createdAt)}`).join(", ")}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">{v}</text>
          </g>
        ))}
        <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth={2.75} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.total)} r={4.5} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        <text x={P.l} y={H - 8} className="fill-muted text-[11px]">{date(points[0].createdAt)}</text>
        <text x={W - P.r} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">{date(points.at(-1)!.createdAt)}</text>
      </svg>
      <figcaption className="sr-only">Each point is one time you scored your application.</figcaption>
    </figure>
  );
}
