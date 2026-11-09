"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { formatBytes, MAX_SLIDES, MAX_UPLOAD_BYTES, validateUploadRequest, type UploadKind } from "@/lib/upload/limits";
import { cn } from "@/lib/utils";

type Phase = "idle" | "preparing" | "uploading" | "verifying" | "done";

/** Upload straight to storage with XMLHttpRequest, because fetch() can't report upload progress. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (pct: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}

/** Upload a textbook (kind="book") or a slide deck (kind="slides": PDF or PowerPoint). */
export function UploadForm({ kind = "book" }: { kind?: UploadKind }) {
  const slides = kind === "slides";
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    const check = validateUploadRequest({ filename: f.name, size: f.size, contentType: f.type, rightsConfirmed: true, kind });
    if (!check.ok) {
      setError(check.error);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function start() {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setProgress(0);
    try {
      setPhase("preparing");
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
    verifying: "Checking the file…",
    done: "Done! Opening your course…",
  };

  return (
    <div className="flex flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) pick(e.dataTransfer.files[0]); }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-primary bg-surface-2" : "border-border bg-surface",
        )}
      >
        <p className="font-medium">{file ? file.name : slides ? "Drag your slides here" : "Drag your textbook PDF here"}</p>
        <p className="text-sm text-muted">
          {file
            ? formatBytes(file.size)
            : slides
              ? `PDF or PowerPoint (.pptx), up to ${formatBytes(MAX_UPLOAD_BYTES)} and ${MAX_SLIDES} slides`
              : `PDF only, up to ${formatBytes(MAX_UPLOAD_BYTES)} and 1,000 pages`}
        </p>
        <input
          ref={inputRef}
          id="pdf-file"
          type="file"
          aria-label={slides ? "Slides file (PDF or PowerPoint)" : "Textbook PDF file"}
          tabIndex={-1} // the "Choose a file" button opens it; drag and drop works too
          accept={slides ? "application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/pdf,.pdf"}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
          disabled={busy}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {file ? "Choose a different file" : "Choose a file"}
        </Button>
      </div>

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
        <Button onClick={start} disabled={!file || !rights || busy}>Upload and continue</Button>
        {phase === "uploading" && (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>Cancel</Button>
        )}
      </div>
    </div>
  );
}
