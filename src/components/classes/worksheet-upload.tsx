"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { postJson, putWithProgress } from "@/components/library/upload-client";
import { formatBytes, validateUploadRequest } from "@/lib/upload/limits";

/** Upload a worksheet PDF; Claude then lists its questions. */
export function WorksheetUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    const check = validateUploadRequest({ filename: f.name, size: f.size, contentType: f.type, rightsConfirmed: true });
    if (!check.ok) return setError(check.error);
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const { worksheetId, upload } = await postJson("/api/worksheets", { filename: file.name, size: file.size, contentType: file.type, rightsConfirmed: rights });
      await putWithProgress(upload.url, file, upload.headers, setProgress, new AbortController().signal);
      await postJson(`/api/worksheets/${worksheetId}/complete`);
      router.push(`/teach/worksheets/${worksheetId}`);
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Worksheet PDF"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
          {file ? "Choose a different PDF" : "Choose a PDF"}
        </Button>
        <span className="text-sm text-muted">{file ? `${file.name} · ${formatBytes(file.size)}` : "A worksheet, problem set or practice test, up to 20 pages. An answer key in the PDF is used."}</span>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} disabled={progress !== null} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          I wrote this worksheet or have the right to use it with my students (not copied from a test publisher&apos;s official materials). See the{" "}
          <Link href="/terms" className="underline" target="_blank">
            Terms
          </Link>
          .
        </span>
      </label>
      {progress !== null && (
        <div aria-live="polite" className="flex flex-col gap-1.5">
          <ProgressBar value={progress} label="Upload progress" />
          <p className="text-xs text-muted">{progress < 100 ? `Uploading… ${Math.round(progress)}%` : "Checking the file…"}</p>
        </div>
      )}
      <div>
        <Button onClick={upload} disabled={!file || !rights || progress !== null}>
          Upload and read questions
        </Button>
      </div>
    </div>
  );
}
