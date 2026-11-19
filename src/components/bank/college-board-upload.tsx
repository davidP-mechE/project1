"use client";

import Link from "next/link";
import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/lesson/markdown";
import { cn } from "@/lib/utils";

type CbRecord = Record<string, string | number | Record<string, string>>;
type Row = { record: CbRecord; figureNote: string; ok: boolean; errors: string[]; warnings: string[]; alreadyInBank: boolean };
type Mode = "pdf" | "images" | "text";

const PAGES_PER_BATCH = 4; // a few pages per request: stays under the host's size and time limits
const MAX_BATCH_BYTES = 3_800_000;
const MAX_PDF_PAGES = 200;
const MAX_IMAGES = 10;
const LETTERS = ["A", "B", "C", "D"] as const;
const DIFFICULTY = ["", "Easy", "Medium", "Hard"];

async function send(form: FormData): Promise<{ rows: Row[]; problems: string }> {
  const res = await fetch("/api/bank/college-board/read", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

/** Split a PDF into small overlapping batches (one page of overlap, so a question across a break is seen whole once). */
async function pdfBatches(file: File): Promise<{ from: number; to: number; total: number; bytes: Uint8Array }[]> {
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total === 0) throw new Error("This PDF has no pages.");
  if (total > MAX_PDF_PAGES) throw new Error(`This PDF has ${total} pages. Upload at most ${MAX_PDF_PAGES} at a time.`);
  const out: { from: number; to: number; total: number; bytes: Uint8Array }[] = [];
  let start = 0;
  while (start < total) {
    let count = Math.min(PAGES_PER_BATCH, total - start);
    for (;;) {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, Array.from({ length: count }, (_, i) => start + i));
      pages.forEach((p) => doc.addPage(p));
      const bytes = await doc.save();
      if (bytes.length <= MAX_BATCH_BYTES || count === 1) {
        if (bytes.length > MAX_BATCH_BYTES) throw new Error(`Page ${start + 1} is too large to send (over 4 MB). Take screenshots of it instead.`);
        out.push({ from: start + 1, to: start + count, total, bytes });
        break;
      }
      count = Math.max(1, Math.floor(count / 2));
    }
    const next = start + count;
    if (next >= total) break;
    start = count > 1 ? next - 1 : next; // overlap one page when the batch has more than one
  }
  return out;
}

/** The same question read twice (batch overlap): keep the first. */
function keyOf(r: Row) {
  return String(r.record.external_id ?? "") || String(r.record.stem ?? "").replace(/\s+/g, " ").slice(0, 300);
}

export function CollegeBoardUpload() {
  const [mode, setMode] = useState<Mode>("pdf");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [problems, setProblems] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ imported: number; skipped: number; failed: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const busy = progress !== null || adding;

  function reset() {
    setRows([]);
    setChosen(new Set());
    setProblems([]);
    setError(null);
    setAdded(null);
  }

  function take(found: Row[], soFar: Row[]) {
    const seen = new Set(soFar.map(keyOf));
    const fresh = found.filter((r) => {
      const k = keyOf(r);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return [...soFar, ...fresh];
  }

  async function run(batches: { label: string; form: () => Promise<FormData> }[]) {
    reset();
    let all: Row[] = [];
    const notes: string[] = [];
    try {
      for (const [i, b] of batches.entries()) {
        setProgress(`Reading ${b.label}${batches.length > 1 ? ` (${i + 1} of ${batches.length})` : ""}… This takes about a minute.`);
        const r = await send(await b.form());
        all = take(r.rows, all);
        if (r.problems) notes.push(batches.length > 1 ? `${b.label}: ${r.problems}` : r.problems);
        setRows(all);
        setChosen(new Set(all.flatMap((row, idx) => (row.ok && !row.alreadyInBank ? [idx] : []))));
      }
      if (all.length === 0) setError("No questions were found in that upload.");
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Something went wrong."}${all.length ? " The questions read so far are below." : ""}`);
    } finally {
      setProblems(notes);
      setProgress(null);
    }
  }

  async function onPdf(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setError("Choose a PDF file.");
    let batches;
    try {
      setProgress("Opening the PDF…");
      batches = await pdfBatches(file);
    } catch (err) {
      setProgress(null);
      return setError(err instanceof Error ? err.message : "That PDF couldn't be opened.");
    }
    await run(
      batches.map((b) => ({
        label: b.from === b.to ? `page ${b.from} of ${b.total}` : `pages ${b.from}–${b.to} of ${b.total}`,
        form: async () => {
          const f = new FormData();
          f.append("file", new File([b.bytes as BlobPart], file.name, { type: "application/pdf" }));
          return f;
        },
      })),
    );
  }

  async function onImages(files: File[]) {
    if (files.length === 0) return;
    if (files.some((f) => !/^image\/(png|jpeg|webp|gif)$/.test(f.type))) return setError("Choose PNG or JPG screenshots.");
    // Send a few at a time so each request stays small.
    const groups: File[][] = [];
    let cur: File[] = [];
    let size = 0;
    for (const f of files.slice(0, 50)) {
      if (cur.length && (cur.length >= MAX_IMAGES || size + f.size > MAX_BATCH_BYTES)) {
        groups.push(cur);
        cur = [];
        size = 0;
      }
      if (f.size > MAX_BATCH_BYTES) return setError(`${f.name} is larger than 4 MB. Crop or resize it.`);
      cur.push(f);
      size += f.size;
    }
    if (cur.length) groups.push(cur);
    await run(
      groups.map((g, i) => ({
        label: groups.length > 1 ? `screenshots, part ${i + 1}` : g.length === 1 ? "the screenshot" : `${g.length} screenshots`,
        form: async () => {
          const f = new FormData();
          g.forEach((file) => f.append("file", file));
          return f;
        },
      })),
    );
  }

  async function onText() {
    if (!text.trim()) return setError("Paste some questions first.");
    await run([
      {
        label: "the pasted text",
        form: async () => {
          const f = new FormData();
          f.append("text", text);
          return f;
        },
      },
    ]);
  }

  async function add() {
    const records = rows.filter((_, i) => chosen.has(i)).map((r) => r.record);
    if (records.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/bank/college-board/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setAdded(data);
      setRows((rs) => rs.map((r, i) => (chosen.has(i) ? { ...r, alreadyInBank: true } : r)));
      setChosen(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAdding(false);
    }
  }

  const toggle = (i: number) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const ready = rows.filter((r) => r.ok && !r.alreadyInBank).length;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="What to upload" className="flex flex-wrap gap-2">
        {(
          [
            ["pdf", "PDF"],
            ["images", "Screenshots"],
            ["text", "Paste text"],
          ] as const
        ).map(([m, label]) => (
          <Button key={m} role="tab" aria-selected={mode === m} size="sm" variant={mode === m ? "primary" : "secondary"} onClick={() => setMode(m)} disabled={busy}>
            {label}
          </Button>
        ))}
      </div>

      {mode === "pdf" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">A PDF from the College Board Question Bank, a practice test, or a handout (with the answer key pages, if you have them)</span>
          <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && onPdf(e.target.files[0])} className="text-sm" />
        </label>
      )}
      {mode === "images" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Screenshots of questions (Bluebook, My Practice, a website). Include the answer and explanation when you can.</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy} onChange={(e) => onImages(Array.from(e.target.files ?? []))} className="text-sm" />
        </label>
      )}
      {mode === "text" && (
        <div className="flex flex-col gap-2">
          <label htmlFor="cb-text" className="text-sm font-medium">Paste questions copied from a College Board page or PDF</label>
          <textarea id="cb-text" value={text} onChange={(e) => setText(e.target.value)} rows={10} maxLength={100_000} disabled={busy} className="rounded-md border-[1.5px] border-border bg-surface p-3 font-mono text-sm" />
          <div>
            <Button onClick={onText} disabled={busy || !text.trim()}>Read questions</Button>
          </div>
        </div>
      )}

      {progress && <Alert>{progress}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {problems.length > 0 && (
        <Alert tone="warning">
          {problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Alert>
      )}
      {added && (
        <Alert tone="success">
          Added {added.imported} question{added.imported === 1 ? "" : "s"} to the bank as drafts.
          {added.skipped > 0 && ` ${added.skipped} were already there.`} Review and publish them from the <Link href="/bank?status=draft" className="underline">question bank</Link>, and add pictures to any with figures.
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
          <span>
            {rows.length} question{rows.length === 1 ? "" : "s"} found · {ready} ready · {chosen.size} chosen
          </span>
          <Button size="sm" variant="secondary" onClick={() => setChosen(new Set(rows.flatMap((r, i) => (r.ok && !r.alreadyInBank ? [i] : []))))} disabled={busy}>
            Choose all ready
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())} disabled={busy}>
            Clear
          </Button>
          <Button size="sm" onClick={add} disabled={busy || chosen.size === 0}>
            {adding ? "Adding…" : `Add ${chosen.size} to the bank`}
          </Button>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const rec = r.record;
          const choices = LETTERS.map((l) => String(rec[`choice_${l.toLowerCase()}`] ?? ""));
          const mcq = rec.type === "mcq";
          const selectable = r.ok && !r.alreadyInBank;
          return (
            <li key={i} className={cn("rounded-lg border-[1.5px] bg-surface p-4", chosen.has(i) ? "border-primary" : "border-border")}>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={chosen.has(i)} disabled={!selectable || busy} onChange={() => toggle(i)} />
                  Question {i + 1}
                </label>
                <span className="rounded bg-surface-2 px-2 py-0.5">{rec.section === "math" ? "Math" : "Reading and Writing"}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5">{String(rec.skill)}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5">{DIFFICULTY[Number(rec.difficulty)] ?? ""}</span>
                {!mcq && <span className="rounded bg-surface-2 px-2 py-0.5">Student-produced response</span>}
                {rec.external_id && <span className="font-mono text-muted">{String(rec.external_id)}</span>}
                {r.alreadyInBank && <span className="font-semibold text-success">In the bank</span>}
              </div>
              <Markdown>{String(rec.stem)}</Markdown>
              {mcq ? (
                <ol className="mt-3 flex flex-col gap-1">
                  {choices.map((c, ci) => (
                    <li key={ci} className={cn("flex gap-2 rounded-md px-2 py-1", rec.answer === LETTERS[ci] && "bg-success-bg font-medium")}>
                      <span className="font-semibold">{LETTERS[ci]}.</span>
                      <Markdown>{c || "(empty)"}</Markdown>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm">
                  Answer: <span className="font-semibold">{String(rec.answer || "not shown")}</span>
                </p>
              )}
              {rec.explanation && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-muted">Explanation</summary>
                  <Markdown className="mt-2">{String(rec.explanation)}</Markdown>
                </details>
              )}
              {r.figureNote && <p className="mt-3 text-sm text-muted">Figure: {r.figureNote}</p>}
              {r.errors.map((e) => (
                <p key={e} className="mt-2 text-sm text-danger">{e}</p>
              ))}
              {r.warnings.map((w) => (
                <p key={w} className="mt-1 text-sm text-warning">{w}</p>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
