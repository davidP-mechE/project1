import { Card } from "@/components/ui/misc";

type Stats = {
  students: number;
  withBaseline: number;
  missingBaseline: number;
  averageBaseline: number | null;
  averageLatest: number | null;
  averageGain: number | null;
  medianGain: number | null;
  onTrack: number;
  byTarget: { target: number; reached: number; averageGap: number | null }[];
  distribution: { from: number; count: number }[];
};

const signed = (n: number | null) => (n === null ? "–" : n >= 0 ? `+${n}` : String(n));

/** The headline numbers for a class or the program: gain, on track, distance to the targets, and where scores sit. */
export function ScoreStats({ stats, goalGain = 300 }: { stats: Stats; goalGain?: number }) {
  const max = Math.max(1, ...stats.distribution.map((b) => b.count));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Average gain</span>
          <span className="text-3xl font-semibold tabular-nums">{signed(stats.averageGain)}</span>
          <span className="text-xs text-muted">Median {signed(stats.medianGain)} · goal +{goalGain}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">On track</span>
          <span className="text-3xl font-semibold tabular-nums">
            {stats.onTrack}
            <span className="text-base font-normal text-muted">/{stats.withBaseline}</span>
          </span>
          <span className="text-xs text-muted">Projected +{goalGain} or at their goal</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Average now</span>
          <span className="text-3xl font-semibold tabular-nums">{stats.averageLatest ?? "–"}</span>
          <span className="text-xs text-muted">Baseline average {stats.averageBaseline ?? "–"}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Missing a baseline</span>
          <span className={stats.missingBaseline ? "text-3xl font-semibold tabular-nums text-warning" : "text-3xl font-semibold tabular-nums"}>{stats.missingBaseline}</span>
          <span className="text-xs text-muted">of {stats.students} {stats.students === 1 ? "student" : "students"}</span>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Distance to the targets</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {stats.byTarget.map((t) => (
              <li key={t.target} className="flex justify-between gap-2">
                <span className="font-medium">{t.target}</span>
                <span className="tabular-nums text-muted">
                  {t.reached} reached · average {t.averageGap ?? "–"} points to go
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">Latest scores</h3>
          <table className="w-full text-sm">
            <caption className="sr-only">How many students&apos; latest scores fall in each range</caption>
            <tbody>
              {stats.distribution
                .filter((b) => b.from >= 700)
                .map((b) => (
                  <tr key={b.from}>
                    <th scope="row" className="w-24 py-0.5 pr-2 text-left font-normal tabular-nums text-muted">
                      {b.from}–{b.from + 90}
                    </th>
                    <td className="py-0.5">
                      <span className="flex items-center gap-2">
                        <span className="h-3 rounded-sm bg-primary" style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count ? 6 : 0 }} aria-hidden />
                        <span className="tabular-nums">{b.count}</span>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
