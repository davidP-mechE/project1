"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { importScoreReportsAction } from "@/server/actions/scores";
import { REPORT_TEMPLATE_HEADERS } from "@/lib/sat/cb-import";
import { cn } from "@/lib/utils";

type Preview = { rows: { line: number; email: string; name: string | null; test: string; total: number; status: string; notes: string[] }[]; added: number; ignoredColumns: string[] };

const TONE: Record<string, string> = { ready: "text-success", "already added": "text-muted", "not in class": "text-warning", error: "text-danger" };

/**
 * Import a class's College Board score reports from a spreadsheet: check
 * first (nothing is saved), then add. Students are matched by email.
 */
export function CbImportForm({ classId }: { classId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${REPORT_TEMPLATE_HEADERS.join(",")}\nstudent@example.com,PSAT/NMSQT,2026-10-15,1010,520,490,3,2,4,3,4,5,3,4\n`)}`;
  const ready = preview?.rows.filter((r) => r.status === "ready").length ?? 0;
  const run = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await importScoreReportsAction(classId, text, dryRun);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setPreview(r);
      if (!dryRun) {
        setMsg({ tone: "success", text: `Added ${r.added} score report${r.added === 1 ? "" : "s"}.` });
        router.refresh();
      }
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        One row per student: email, test, date, total, section scores, and each content area&apos;s Knowledge and Skills band (1–7). Export it from College Board&apos;s reporting portal or fill in{" "}
        <a href={template} download="college-board-scores-template.csv" className="font-medium text-primary underline">
          our template
        </a>
        ; columns are matched by name. Students are matched by email and must be in this class.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Spreadsheet file (CSV)</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
            setPreview(null);
          }}
          className="text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Or paste it</span>
        <textarea value={text} onChange={(e) => (setText(e.target.value), setPreview(null))} rows={4} className="rounded-lg border border-border bg-surface p-2 font-mono text-xs" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={pending || !text.trim()} onClick={() => run(true)}>
          Check
        </Button>
        <Button type="button" disabled={pending || !preview || ready === 0} onClick={() => run(false)}>
          Add {ready || ""} score report{ready === 1 ? "" : "s"}
        </Button>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {preview && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Rows in the spreadsheet</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">Line</th>
                <th scope="col" className="py-1 pr-3 font-medium">Student</th>
                <th scope="col" className="py-1 pr-3 font-medium">Test</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Total</th>
                <th scope="col" className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.rows.map((r) => (
                <tr key={r.line}>
                  <td className="py-1 pr-3 tabular-nums text-muted">{r.line}</td>
                  <th scope="row" className="py-1 pr-3 font-normal">{r.name ?? r.email}</th>
                  <td className="py-1 pr-3">{r.test}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.total || "–"}</td>
                  <td className={cn("py-1", TONE[r.status])}>
                    {r.status}
                    {r.notes.length > 0 && <span className="block text-xs text-muted">{r.notes.join("; ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.ignoredColumns.length > 0 && <p className="mt-1 text-xs text-muted">Ignored columns: {preview.ignoredColumns.join(", ")}.</p>}
        </div>
      )}
    </div>
  );
}

/** Weakest content areas first, with what each is based on. */
export function WeakSpots({ data, compact }: { data: { domains: { domain: string; name: string; section: string; strength: number | null; band: number | null; bandFrom: string | null; cbRight: number; cbTotal: number; siteAccuracy: number | null; siteAnswers: number; openMistakes: number }[]; skills: { skill: string; domainName: string; missed: number; seen: number }[]; sources: { reports: number; reviews: number } }; compact?: boolean }) {
  const known = data.domains.filter((d) => d.strength !== null);
  if (!known.length) return <p className="text-sm text-muted">Not enough results yet. Add a College Board score report (with its Knowledge and Skills bands) or paste a practice test&apos;s question review, or do some assigned work.</p>;
  const list = compact ? known.slice(0, 3) : data.domains;
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {list.map((d, i) => (
          <li key={d.domain} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>
                {d.strength !== null && i < 3 && <span className="mr-1.5 rounded bg-danger-bg px-1.5 py-0.5 text-xs font-semibold text-danger">Focus</span>}
                <span className="font-medium">{d.name}</span> <span className="text-xs text-muted">({d.section === "MATH" ? "Math" : "R&W"})</span>
              </span>
              <span className="text-xs tabular-nums text-muted">{d.strength === null ? "no data" : `${Math.round(d.strength * 100)}%`}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-2" aria-hidden>
              {d.strength !== null && <div className="h-2 rounded-full bg-chart-1" style={{ width: `${Math.max(3, d.strength * 100)}%` }} />}
            </div>
            <p className="text-xs text-muted">
              {[
                d.band !== null ? `College Board band ${d.band}/7${d.bandFrom ? ` (${d.bandFrom})` : ""}` : null,
                d.cbTotal ? `${d.cbRight}/${d.cbTotal} right in College Board reviews` : null,
                d.siteAnswers >= 3 && d.siteAccuracy !== null ? `${Math.round(d.siteAccuracy * 100)}% on ${d.siteAnswers} practice answers` : null,
                d.openMistakes ? `${d.openMistakes} in the mistake log` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "No results yet"}
            </p>
          </li>
        ))}
      </ol>
      {data.skills.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Skills missed most</h3>
          <ul className="mt-1 text-sm">
            {data.skills.map((s) => (
              <li key={s.skill}>
                {s.skill} <span className="text-xs text-muted">({s.domainName}): missed {s.missed} of {s.seen}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">
        From {data.sources.reports} College Board score report{data.sources.reports === 1 ? "" : "s"} with bands, {data.sources.reviews} question review{data.sources.reviews === 1 ? "" : "s"} and the last 90 days of practice here. Percentages combine them; College Board bands are not official percentages.
      </p>
    </div>
  );
}
