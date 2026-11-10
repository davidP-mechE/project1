/**
 * The SAT score display: a half-circle gauge from 400 to 1600, ink
 * for the score so far, gold ticks for the baseline and the goal. The number
 * underneath is the score; screen readers get the same as one sentence.
 */
export function ScoreGauge({ score, baseline, goal, label = "Latest score", caption }: { score: number | null; baseline?: number | null; goal?: number | null; label?: string; caption?: string }) {
  const cx = 150;
  const cy = 142;
  const R = 112;
  const ang = (v: number) => Math.PI * (1 - (Math.min(1600, Math.max(400, v)) - 400) / 1200);
  const pt = (v: number, r = R) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))] as const;
  const [sx, sy] = pt(400);
  const [tx, ty] = pt(1600);
  const desc = score === null ? `${label}: none yet` : `${label}: ${score} of 1600${baseline ? `, up from ${baseline}` : ""}${goal ? `; goal ${goal}` : ""}`;
  return (
    <figure className="flex flex-col items-center gap-1">
      <figcaption className="eyebrow self-start">{label}</figcaption>
      <svg viewBox="0 0 300 176" className="w-full max-w-[22rem]" role="img" aria-label={desc}>
        <path d={`M${sx},${sy} A${R},${R} 0 0 1 ${tx},${ty}`} fill="none" stroke="var(--surface-2)" strokeWidth="18" strokeLinecap="round" />
        {score !== null && (
          <path d={`M${sx},${sy} A${R},${R} 0 0 1 ${pt(score)[0].toFixed(1)},${pt(score)[1].toFixed(1)}`} fill="none" stroke="var(--chart-1)" strokeWidth="18" strokeLinecap="round" />
        )}
        {[
          [baseline, "Start"],
          [goal, "Goal"],
        ].map(([v, name]) => {
          if (!v || typeof v !== "number") return null;
          const [x1, y1] = pt(v, R - 17);
          const [x2, y2] = pt(v, R + 17);
          const [lx, ly] = pt(v, R + 31);
          return (
            <g key={String(name)}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" />
              <text x={lx} y={ly} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--text-muted)">
                {name} {v}
              </text>
            </g>
          );
        })}
        <text x={cx} y={cy - 8} textAnchor="middle" className="score-num" fontSize="48" fill="var(--text)">
          {score ?? "–"}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="1.6" fill="var(--text-muted)">
          OF 1600
        </text>
      </svg>
      {caption && <p className="text-center text-xs text-muted">{caption}</p>}
    </figure>
  );
}
