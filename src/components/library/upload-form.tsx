"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { formatBytes, MAX_DECKS_PER_UPLOAD, MAX_SLIDES, MAX_UPLOAD_BYTES, titleFromFilename, validateUploadRequest, type UploadKind } from "@/lib/upload/limits";
import { cn } from "@/lib/utils";
import { postJson, putWithProgress, uploadDecks } from "./upload-client";
import { DeckList } from "./deck-list";

type Phase = "idle" | "preparing" | "uploading" | "verifying" | "done";

/**
 * Upload a textbook (kind="book") or slides (kind="slides": PDF or PowerPoint).
 * Several slide decks at once become one course (a collage), one unit per deck.
 */
export function UploadForm({ kind = "book" }: { kind?: UploadKind }) {
  const slides = kind === "slides";
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const file = files[0] ?? null;
  const collage = slides && files.length > 1;
  const [rights, setRights] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  function pick(list: FileList | null | undefined) {
    setError(null);
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    if (!slides) picked.splice(1); // one textbook at a time
    for (const f of picked) {
      const check = validateUploadRequest({ filename: f.name, size: f.size, contentType: f.type, rightsConfirmed: true, kind });
      if (!check.ok) {
        setError(picked.length > 1 ? `${f.name}: ${check.error}` : check.error);
        return;
      }
    }
    // Slides: more files add to the list (same file twice is ignored); a textbook replaces the choice.
    const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
    const next = slides ? [...files, ...picked.filter((f) => !files.some((g) => key(g) === key(f)))] : picked;
    if (next.length > MAX_DECKS_PER_UPLOAD) {
      setError(`You can upload up to ${MAX_DECKS_PER_UPLOAD} decks at a time. Add more to the course afterwards.`);
      return;
    }
    setFiles(next);
  }

  async function start() {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress(0);
    try {
      setPhase("preparing");
      if (collage) {
        // Several decks → one course: ask for an upload URL per deck, upload them in order, then start merging.
        const { courseId, uploads } = await postJson("/api/collages", {
          title: title.trim() || titleFromFilename(files[0].name),
          files: files.map((f) => ({ filename: f.name, size: f.size, contentType: f.type })),
          rightsConfirmed: rights,
        });
        setPhase("uploading");
        await uploadDecks(uploads, files, setProgress, controller.signal);
        setPhase("verifying");
        await postJson(`/api/courses/${courseId}/decks/complete`);
        setPhase("done");
        router.push(`/courses/${courseId}`);
        return;
      }
      const { bookId, upload } = await postJson("/api/uploads", {
        filename: file.name,
        size: file.size,
        contentType: file.type,
        rightsConfirmed: rights,
        kind,
      });
      setPhase("uploading");
      await putWithProgress(upload.url, file, upload.headers, setProgress, controller.signal);
      setPhase("verifying");
      const { courseId } = await postJson(`/api/uploads/${bookId}/complete`);
      setPhase("done");
      router.push(`/courses/${courseId}`);
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
    }
  }

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    preparing: "Preparing upload…",
    uploading: `Uploading… ${Math.round(progress)}%`,
    verifying: collage ? "Checking the files…" : "Checking the file…",
    done: "Done! Opening your course…",
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) pick(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-primary bg-surface-2" : "border-border bg-surface",
        )}
      >
        <p className="font-medium">
          {collage ? `${files.length} decks, one course` : file ? file.name : slides ? "Drag your slides here" : "Drag your textbook PDF here"}
        </p>
        <p className="text-sm text-muted">
          {collage
            ? "Each deck becomes a unit, in this order. Drop more to add them."
            : file
              ? formatBytes(file.size)
              : slides
                ? `PDF or PowerPoint (.pptx), up to ${formatBytes(MAX_UPLOAD_BYTES)} and ${MAX_SLIDES} slides each. Choose several decks to make one course from them.`
                : `PDF only, up to ${formatBytes(MAX_UPLOAD_BYTES)} and 1,000 pages`}
        </p>
        <input
          ref={inputRef}
          id="pdf-file"
          type="file"
          aria-label={slides ? "Slides files (PDF or PowerPoint)" : "Textbook PDF file"}
          multiple={slides}
          tabIndex={-1} // the "Choose a file" button opens it; drag and drop works too
          accept={slides ? "application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/pdf,.pdf"}
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = ""; // so choosing the same file again still works
          }}
          disabled={busy}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {slides ? (file ? "Add more decks" : "Choose files") : file ? "Choose a different file" : "Choose a file"}
        </Button>
      </div>

      {collage && (
        <div className="flex flex-col gap-4">
          <Field
            label="Course name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder={titleFromFilename(files[0].name)}
            disabled={busy}
          />
          <DeckList files={files} onChange={setFiles} disabled={busy} />
        </div>
      )}

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          {slides
            ? "These are my own slides, or slides I've been given for a course I'm taking (or I otherwise have the right to use them) for my personal study. See the"
            : "I own this textbook or otherwise have the right to use it for my personal study. See the"}{" "}
          <Link href="/terms" className="underline" target="_blank">Terms</Link>.
        </span>
      </label>

      {busy && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <ProgressBar value={phase === "uploading" ? progress : phase === "preparing" ? 0 : 100} label="Upload progress" />
          <p className="text-sm text-muted">{phaseLabel[phase]}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={start} disabled={!file || !rights || busy}>
          {collage ? `Upload ${files.length} decks as one course` : "Upload and continue"}
        </Button>
        {phase === "uploading" && (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>Cancel</Button>
        )}
      </div>
    </div>
  );
}
