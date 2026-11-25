"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/misc";
import { postJson, putWithProgress } from "@/components/library/upload-client";
import { applyExtractionsAction, removeUploadAction } from "@/server/actions/academic-index";
import { FILE_TYPES, FILE_TYPE_KEYS, MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_SESSION, type FileType } from "@/lib/academic-index/extraction";

/** Upload application PDFs (straight to storage), then review what was read. */
export function ImportForm({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const typeId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState<FileType>("COMMON_APP");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = activeCount >= MAX_UPLOADS_PER_SESSION;

  async function upload(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setError("Upload a PDF.");
    if (file.size > MAX_UPLOAD_BYTES) return setError("PDFs can be up to 20 MB.");
    setProgress(0);
    try {
      const { uploadId, upload } = await postJson("/api/academic-index/uploads", { fileType, size: file.size, contentType: "application/pdf" });
      await putWithProgress(upload.url, file, upload.headers, setProgress, new AbortController().signal);
      await postJson(`/api/academic-index/uploads/${uploadId}/complete`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={typeId} className="text-sm font-medium">Which file is it?</label>
        <select id={typeId} value={fileType} onChange={(e) => setFileType(e.target.value as FileType)} className={`${inputClasses} max-w-sm`}>
          {FILE_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>{FILE_TYPES[k].long}</option>
          ))}
        </select>
        <p className="text-xs text-muted">Where to get it: {FILE_TYPES[fileType].where}. Fills in: {FILE_TYPES[fileType].fills}.</p>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" aria-label="Application PDF" tabIndex={-1} className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => fileRef.current?.click()} disabled={progress !== null || full}>Choose PDF and upload</Button>
        <span className="text-xs text-muted">PDF, up to 20 MB. Up to {MAX_UPLOADS_PER_SESSION} files at a time.</span>
      </div>
      {full && <Alert tone="info">You have {MAX_UPLOADS_PER_SESSION} files waiting. Review them (or remove one) to upload more.</Alert>}
      {progress !== null && <ProgressBar value={progress} label="Upload progress" />}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** While a file is being read, check back every few seconds. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function RemoveUploadButton({ uploadId }: { uploadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await removeUploadAction(uploadId); router.refresh(); })}>
      Delete file
    </Button>
  );
}

export function ReviewButton({ count }: { count: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await applyExtractionsAction();
              if (r.ok) router.push("/academic-index/inputs?review=1");
              else setError(r.error);
            })
          }
        >
          Review {count} file{count === 1 ? "" : "s"}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
