"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { importQuestionsAction } from "@/server/actions/bank";
import { cn } from "@/lib/utils";

type Row = { row: number; externalId: string | null; ok: boolean; errors: string[]; warnings: string[]; stem: string | null };
type Report = { rows: Row[]; imported: number; skipped: { row: number; externalId: string | null; reason: string }[]; failed: number };

const MAX_BYTES = 5_000_000;

/** Upload a CSV or JSON file, preview every row with its problems, then import the good rows as drafts. */
export function ImportForm() {
  const [file, setFile] = useState<{ name: string; text: string; format: "csv" | "json" } | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [done, setDone] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [onlyProblems, setOnlyProblems] = useState(false);

  async function choose(f: File) {
    setError(null);
    setPreview(null);
    setDone(null);
    const format = f.name.toLowerCase().endsWith(".csv") ? "csv" : f.name.toLowerCase().endsWith(".json") ? "json" : null;
    if (!format) return setError("Choose a .csv or .json file.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 5 MB.");
    const text = await f.text();
    setFile({ name: f.name, text, format });
    start(async () => {
      const r = await importQuestionsAction(text, format, false);
      if (!r.ok) return setError(r.error);
      setPreview(r.report);
    });
  }

  const commit = () =>
    file &&
    start(async () => {
      const r = await importQuestionsAction(file.text, file.format, true);
      if (!r.ok) return setError(r.error);
      setDone(r.report);
      setPreview(null);
    });

  const report = done ?? preview;
  const skipped = new Set(report?.skipped.map((s) => s.row));
  const rows = report ? report.rows.filter((r) => !onlyProblems || !r.ok || r.warnings.length || skipped.has(r.row)) : [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".csv,.json,text/csv,application/json" aria-label="Choose a CSV or JSON file" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} className="text-sm" />
        {pending && <span className="text-sm text-muted">Checking…</span>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <Alert tone="success">
          Imported {done.imported} question{done.imported === 1 ? "" : "s"} as drafts. {done.failed > 0 && `${done.failed} row${done.failed === 1 ? "" : "s"} had problems and weren't imported (listed below). `}
          {done.skipped.length > 0 && `${done.skipped.length} were already in the bank.`}
        </Alert>
      )}
      {preview && (
        <Alert tone={preview.failed ? "warning" : "info"}>
          {file?.name}: {preview.rows.length} rows. {preview.imported} ready to import as drafts{preview.failed ? `, ${preview.failed} with problems (they'll be skipped)` : ""}
          {preview.skipped.length ? `, ${preview.skipped.length} already in the bank` : ""}.
        </Alert>
      )}
      {preview && preview.imported > 0 && (
        <div>
          <Button onClick={commit} disabled={pending}>
            Import {preview.imported} question{preview.imported === 1 ? "" : "s"}
          </Button>
        </div>
      )}
      {report && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
          </label>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Rows in the file</caption>
              <thead className="bg-surface-2 text-left">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Id</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className="border-t border-border align-top">
                    <td className="px-3 py-2 tabular-nums">{r.row}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.externalId ?? "–"}</td>
                    <td className={cn("px-3 py-2 font-semibold", r.ok ? (skipped.has(r.row) ? "text-muted" : "text-success") : "text-danger")}>{!r.ok ? "Problem" : skipped.has(r.row) ? "Already there" : done ? "Imported" : "OK"}</td>
                    <td className="px-3 py-2">
                      {r.errors.map((e) => (
                        <p key={e} className="text-danger">{e}</p>
                      ))}
                      {r.warnings.map((w) => (
                        <p key={w} className="text-warning">{w}</p>
                      ))}
                      {r.ok && r.stem && <p className="truncate text-muted">{r.stem}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
