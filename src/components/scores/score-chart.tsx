import { SOURCE_LABEL, type ScoreSource } from "@/lib/sat/scores";

type Point = { takenOn: Date; total: number; source: string };

const W = 640;
const H = 260;
const PAD = { l: 44, r: 16, t: 16, b: 32 };
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A student's score history: one line through every score, each point marked
 * by source (official tests filled, practice hollow), dashed target lines, and
 * the projected range as a shaded band at the right. The table below it has
 * the same data for screen readers.
 */
export function ScoreChart({ points, targets, projection, now = new Date() }: { points: Point[]; targets: number[]; projection: { low: number; high: number; mid: number } | null; now?: Date }) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.takenOn.getTime() - b.takenOn.getTime());
  const t0 = sorted[0].takenOn.getTime();
  const tEnd = Math.max(sorted.at(-1)!.takenOn.getTime(), projection ? now.getTime() : 0, t0 + 7 * 86_400_000);
  const values = [...sorted.map((p) => p.total), ...targets, ...(projection ? [projection.low, projection.high] : [])];
  const lo = Math.max(400, Math.floor((Math.min(...values) - 50) / 100) * 100);
  const hi = Math.min(1600, Math.ceil((Math.max(...values) + 50) / 100) * 100);
  const x = (t: number) => PAD.l + ((t - t0) / (tEnd - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += hi - lo > 400 ? 200 : 100) ticks.push(v);
  const official = (s: string) => s === "SAT" || s === "PSAT";
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.takenOn.getTime()).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");

  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Score history: ${sorted.map((p) => `${p.total} on ${fmt(p.takenOn)}`).join(", ")}${projection ? `; estimated now ${projection.low} to ${projection.high}` : ""}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v}
            </text>
          </g>
        ))}
        {targets
          .filter((t) => t >= lo && t <= hi)
          .map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-accent" strokeWidth={1.5} strokeDasharray="6 4" />
              <text x={W - PAD.r} y={y(t) - 5} textAnchor="end" className="fill-accent-ink text-[11px] font-semibold">
                Goal {t}
              </text>
            </g>
          ))}
        {projection && (
          <g>
            <rect x={x(sorted.at(-1)!.takenOn.getTime())} width={Math.max(4, x(tEnd) - x(sorted.at(-1)!.takenOn.getTime()))} y={y(projection.high)} height={Math.max(2, y(projection.low) - y(projection.high))} className="fill-primary/15" />
            <line x1={x(sorted.at(-1)!.takenOn.getTime())} x2={x(tEnd)} y1={y(sorted.at(-1)!.total)} y2={y(projection.mid)} className="stroke-primary" strokeWidth={2} strokeDasharray="3 4" />
          </g>
        )}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinejoin="round" />
        {sorted.map((p, i) => (
          <circle key={i} cx={x(p.takenOn.getTime())} cy={y(p.total)} r={official(p.source) ? 5.5 : 4.5} className={official(p.source) ? "fill-primary stroke-surface" : "fill-surface stroke-primary"} strokeWidth={2} />
        ))}
        <text x={PAD.l} y={H - 8} className="fill-muted text-[11px]">
          {fmt(sorted[0].takenOn)}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">
          {projection ? "Now" : fmt(sorted.at(-1)!.takenOn)}
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>● Official SAT/PSAT</span>
        <span>○ Practice or diagnostic</span>
        {targets.length > 0 && <span>- - Goals</span>}
        {projection && <span>Shaded: estimated range now (not an official score)</span>}
      </figcaption>
    </figure>
  );
}

export function ScoreTable({ scores, showSections = { rw: true, math: true }, actions }: { scores: { id: string; takenOn: Date; source: string; testName: string | null; total: number; rw: number | null; math: number | null; isBaseline: boolean; verified: boolean; missed: unknown[] }[]; showSections?: { rw: boolean; math: boolean }; actions?: (id: string, verified: boolean) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Scores, newest first</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Date</th>
            <th scope="col" className="py-2 pr-3 font-medium">Test</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Total</th>
            {showSections.rw && <th scope="col" className="py-2 pr-3 text-right font-medium">R&amp;W</th>}
            {showSections.math && <th scope="col" className="py-2 pr-3 text-right font-medium">Math</th>}
            <th scope="col" className="py-2 pr-3 font-medium">Missed</th>
            {actions && <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...scores].reverse().map((s) => (
            <tr key={s.id}>
              <td className="whitespace-nowrap py-2 pr-3">{fmt(s.takenOn)}</td>
              <th scope="row" className="py-2 pr-3 font-normal">
                {s.testName || SOURCE_LABEL[s.source as ScoreSource] || s.source}
                {s.isBaseline && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Baseline</span>}
                {!s.verified && <span className="ml-2 text-xs text-muted">(not verified)</span>}
              </th>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums">{s.total}</td>
              {showSections.rw && <td className="py-2 pr-3 text-right tabular-nums">{s.rw ?? "–"}</td>}
              {showSections.math && <td className="py-2 pr-3 text-right tabular-nums">{s.math ?? "–"}</td>}
              <td className="py-2 pr-3 tabular-nums">{s.missed.length || "–"}</td>
              {actions && <td className="py-2">{actions(s.id, s.verified)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
