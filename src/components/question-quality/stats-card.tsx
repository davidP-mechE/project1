import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import type { QuestionStats } from "@/server/question-stats";
import type { VersionStats } from "@/lib/bank/stats";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

function Distribution({ s, type, answer }: { s: VersionStats; type: "mcq" | "grid_in"; answer: string }) {
  if (!s.attempts) return <p className="text-sm text-muted">No answers yet.</p>;
  const rows = type === "mcq" ? ["A", "B", "C", "D"].map((l) => ({ answer: l, n: s.answers.find((a) => a.answer === l)?.n ?? 0, correct: l === answer })) : s.answers.filter((a) => !a.correct).slice(0, 5);
  const top = Math.max(1, ...rows.map((r) => r.n));
  return (
    <table className="w-full max-w-md text-sm">
      <caption className="mb-1 text-left text-xs font-medium text-muted">{type === "mcq" ? "How often each choice was picked" : "Most common wrong answers"}</caption>
      <tbody>
        {rows.length === 0 ? (
          <tr><td className="text-muted">No wrong answers yet.</td></tr>
        ) : (
          rows.map((r) => (
            <tr key={r.answer}>
              <th scope="row" className={r.correct ? "w-20 py-0.5 pr-2 text-left font-semibold text-success" : "w-20 py-0.5 pr-2 text-left font-medium"}>{r.answer}{r.correct ? " ✓" : ""}</th>
              <td className="py-0.5">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={r.correct ? "h-3 rounded-sm bg-success" : "h-3 rounded-sm bg-primary"} style={{ width: `${Math.max(2, (r.n / top) * 100)}%` }} />
                  <span className="tabular-nums">{r.n} ({pct(r.n / s.attempts)})</span>
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/** Stats for one question: the current version, older versions separately, and any "likely bad" flags. */
export function QuestionStatsCard({ stats, type, answer }: { stats: QuestionStats; type: "mcq" | "grid_in"; answer: string }) {
  const c = stats.current;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">How students did</h2>
      {stats.flags.length > 0 && (
        <Alert tone="warning">
          <p className="font-semibold">This question may have a problem:</p>
          <ul className="mt-1 list-disc pl-5">{stats.flags.map((f) => <li key={f.code}>{f.text}</li>)}</ul>
        </Alert>
      )}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Answers (version " + stats.version + ")", String(c.attempts)],
          ["Correct", pct(c.pct)],
          ["Average time", c.avgSeconds === null ? "–" : `${c.avgSeconds} s`],
          ["Open reports", String(stats.openReports)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <Distribution s={c} type={type} answer={answer} />
      {stats.openReports > 0 && <p className="text-sm"><Link href="/teach/question-reports" className="text-primary underline underline-offset-2">See the reports</Link></p>}
      {stats.older.attempts > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Earlier versions ({stats.olderVersions.join(", ")}): {stats.older.attempts} answers, {pct(stats.older.pct)} correct</summary>
          <div className="mt-2"><Distribution s={stats.older} type={type} answer={answer} /></div>
          <p className="mt-1 text-xs text-muted">Earlier versions had different wording or answers, so they don&apos;t count toward the flags.</p>
        </details>
      )}
    </Card>
  );
}
