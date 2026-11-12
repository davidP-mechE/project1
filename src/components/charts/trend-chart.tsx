/**
 * The shared chart style for comparisons over time: one line per series in the
 * chart palette (--chart-1…5), light grid, month labels, a legend, and the same
 * numbers as a table under "Show the numbers" for anyone who prefers it (and
 * for screen readers). Gaps are months with no data.
 */

const W = 640;
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 28 };
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const DASH = ["", "", "", "", "", "6 4", "6 4", "6 4", "2 3", "2 3"];
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });

export type TrendSeries = { name: string; values: (number | null)[]; counts?: number[] };

/** `labels` (optional) replaces the month labels, e.g. one point per logged test. */
export function TrendChart({ title, months, series, unit = "", domain, labels, empty }: { title: string; months: string[]; series: TrendSeries[]; unit?: string; domain?: [number, number]; labels?: string[]; empty?: string }) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!all.length) return <p className="text-sm text-muted">{empty ?? `No data in the last ${months.length} months yet.`}</p>;
  const lo = domain?.[0] ?? Math.max(0, Math.floor((Math.min(...all) - 20) / 50) * 50);
  const hi = domain?.[1] ?? Math.ceil((Math.max(...all) + 20) / 50) * 50;
  const x = (i: number) => PAD.l + (i / Math.max(1, months.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const step = (hi - lo) / 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round(lo + i * step));
  const paths = series.map((s) =>
    s.values
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .reduce<string[]>((acc, p, i, arr) => (p === null ? acc : [...acc, `${i === 0 || arr[i - 1] === null ? "M" : "L"}${p}`]), [])
      .join(" "),
  );
  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. ${series.map((s) => `${s.name}: latest ${[...s.values].reverse().find((v) => v !== null) ?? "no data"}${unit}`).join("; ")}. The numbers are in the table below.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {t}
              {unit}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          i % 2 === months.length % 2 ? null : (
            <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
              {labels ? labels[months.indexOf(m)] : monthLabel(m)}
            </text>
          ),
        )}
        {series.map((s, si) => (
          <g key={s.name}>
            <path d={paths[si]} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2.5} strokeDasharray={DASH[si % DASH.length] || undefined} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3.2} fill={COLORS[si % COLORS.length]} />))}
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s, si) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <svg aria-hidden width="18" height="6">
                <line x1="0" x2="18" y1="3" y2="3" stroke={COLORS[si % COLORS.length]} strokeWidth="3" strokeDasharray={DASH[si % DASH.length] || undefined} />
              </svg>
              {s.name}
            </li>
          ))}
        </ul>
      </figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted">Show the numbers</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="py-1 pr-3 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {months.map((m, i) => (
                <tr key={m}>
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {labels ? labels[months.indexOf(m)] : `${monthLabel(m)} ${m.slice(0, 4)}`}
                  </th>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-3 text-right tabular-nums">
                      {s.values[i] === null ? "–" : `${s.values[i]}${unit}`}
                      {s.counts?.[i] ? <span className="text-muted"> ({s.counts[i]})</span> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted">In brackets: how many scores or answers each average is from.</p>
        </div>
      </details>
    </figure>
  );
}

/** Side-by-side averages (alphabetical, not ranked), in the same palette. */
export function BarList({ title, bars, unit = "" }: { title: string; bars: { label: string; value: number | null; n: number }[]; unit?: string }) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value ?? 0)));
  if (!bars.length) return <p className="text-sm text-muted">No data yet.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{title}</caption>
      <tbody>
        {bars.map((b) => (
          <tr key={b.label}>
            <th scope="row" className="w-1/3 py-1.5 pr-3 text-left font-normal">
              {b.label}
            </th>
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                <div className="h-3 flex-1 rounded-full bg-surface-2">
                  {b.value !== null && <div className="h-3 rounded-full bg-chart-1" style={{ width: `${Math.max(2, (Math.abs(b.value) / max) * 100)}%` }} />}
                </div>
                <span className="w-24 text-right tabular-nums">
                  {b.value === null ? "–" : `${b.value > 0 ? "+" : ""}${b.value}${unit}`} <span className="text-xs text-muted">({b.n})</span>
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
