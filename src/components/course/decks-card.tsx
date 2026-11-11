"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { DeckList } from "@/components/library/deck-list";
import { postJson, uploadDecks } from "@/components/library/upload-client";
import { removeDeckAction, retryDecksAction } from "@/server/actions/collage";
import { MAX_DECKS_PER_UPLOAD, validateUploadRequest } from "@/lib/upload/limits";

type Deck = { id: string; title: string; originalFilename: string; status: string; error: string | null; pageStart: number | null; pageEnd: number | null; retryable?: boolean };

const range = (d: Deck) => (d.pageStart && d.pageEnd ? (d.pageStart === d.pageEnd ? `slide ${d.pageStart}` : `slides ${d.pageStart}–${d.pageEnd}`) : "");

/**
 * A slides course's decks (each one a unit) and "Add slides": more decks can be
 * added at any time. They're merged in the background; lessons already written
 * stay as they are, and the new ones wait to be generated.
 */
export function DecksCard({ courseId, decks, pageCount, canAdd }: { courseId: string; decks: Deck[]; pageCount: number | null; canAdd: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [adding, setAdding] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const busy = decks.some((d) => d.status === "UPLOADED" || (d.status === "MERGED" && !d.error));
  const retryable = decks.filter((d) => d.retryable);
  // A course made from one deck: show it as deck 1.
  const shown: Deck[] = decks.length > 0 ? decks : [{ id: "only", title: "Original slides", originalFilename: "", status: "READY", error: null, pageStart: 1, pageEnd: pageCount }];

  // While decks are being merged, check back every few seconds.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [busy, router]);

  function pick(list: FileList | null) {
    setError(null);
    const picked = Array.from(list ?? []);
    for (const f of picked) {
      const check = validateUploadRequest({ filename: f.name, size: f.size, contentType: f.type, rightsConfirmed: true, kind: "slides" });
      if (!check.ok) return setError(`${f.name}: ${check.error}`);
    }
    const next = [...files, ...picked.filter((f) => !files.some((g) => g.name === f.name && g.size === f.size))];
    if (next.length > MAX_DECKS_PER_UPLOAD) return setError(`You can add up to ${MAX_DECKS_PER_UPLOAD} decks at a time.`);
    setFiles(next);
  }

  async function upload() {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNote(null);
    setProgress(0);
    try {
      const { uploads } = await postJson(`/api/courses/${courseId}/decks`, {
        files: files.map((f) => ({ filename: f.name, size: f.size, contentType: f.type })),
        rightsConfirmed: rights,
      });
      await uploadDecks(uploads, files, setProgress, controller.signal);
      const res = await postJson(`/api/courses/${courseId}/decks/complete`);
      const bad = (res.failed ?? []) as { filename: string; error: string }[];
      setNote(bad.length > 0 ? `${bad.map((b) => b.filename).join(", ")} couldn't be added (see below). The others are being added now.` : "Adding your slides… This usually takes a minute or two.");
      setFiles([]);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  return (
    <Card className="mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Slide decks</h2>
          <p className="text-sm text-muted">Each deck is a unit of this course. Add more any time, like next week&apos;s lecture.</p>
        </div>
        {canAdd && !adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} disabled={busy}>
            Add slides
          </Button>
        )}
      </div>

      {note && (
        <Alert tone="info" className="mb-4">
          {note}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <ol className="flex flex-col divide-y divide-border text-sm">
        {shown.map((d, i) => (
          <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0">
              <span className="mr-2 font-semibold tabular-nums text-muted">{i + 1}.</span>
              <span className="font-medium">{d.title}</span>
              {d.originalFilename && d.originalFilename !== d.title && <span className="ml-2 text-xs text-muted">{d.originalFilename}</span>}
            </span>
            <span className="text-xs text-muted">
              {d.status === "READY" && range(d)}
              {(d.status === "UPLOADED" || (d.status === "MERGED" && !d.error)) && <span className="font-medium text-accent-ink">Adding…</span>}
            </span>
            {(d.status === "FAILED" || (d.status === "MERGED" && d.error)) && (
              <span className="w-full text-xs text-danger">
                Couldn&apos;t add this deck: {d.error ?? "something went wrong."}{" "}
                {d.status === "FAILED" && (
                  <button type="button" className="underline hover:no-underline" disabled={pending} onClick={() => act(() => removeDeckAction(courseId, d.id))}>
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      {retryable.length > 0 && !busy && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => retryDecksAction(courseId))}>
            Try adding {retryable.length === 1 ? "it" : "them"} again
          </Button>
        </div>
      )}

      {adding && (
        <div className="mt-4 flex flex-col gap-4 rounded-xl border border-dashed border-border p-4">
          <input
            ref={inputRef}
            type="file"
            multiple
            aria-label="Slide decks to add (PDF or PowerPoint)"
            tabIndex={-1}
            accept="application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
              {files.length > 0 ? "Choose more decks" : "Choose decks"}
            </Button>
            <span className="text-xs text-muted">PDF or PowerPoint (.pptx). They&apos;re added after the decks above, in this order.</span>
          </div>
          {files.length > 0 && <DeckList files={files} onChange={setFiles} disabled={progress !== null} />}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} disabled={progress !== null} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>
              These are my own slides, or slides I&apos;ve been given for a course I&apos;m taking (or I otherwise have the right to use them) for my personal study. See the{" "}
              <Link href="/terms" className="underline" target="_blank">
                Terms
              </Link>
              .
            </span>
          </label>
          {progress !== null && (
            <div aria-live="polite" className="flex flex-col gap-1.5">
              <ProgressBar value={progress} label="Upload progress" />
              <p className="text-xs text-muted">Uploading… {Math.round(progress)}%</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={upload} disabled={files.length === 0 || !rights || progress !== null}>
              Add {files.length > 1 ? `${files.length} decks` : "deck"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                abortRef.current?.abort();
                setAdding(false);
                setFiles([]);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
