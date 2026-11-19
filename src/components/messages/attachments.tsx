"use client";

import { useRef, useState } from "react";
import { postJson, putWithProgress } from "@/components/library/upload-client";
import { formatBytes } from "@/lib/upload/limits";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, claimedType } from "@/lib/files/sniff";

export type PendingFile = { key: string; name: string; size: number; id?: string; progress: number; error?: string };

/**
 * "Attach a file" for the reply box: each file is sent to storage, then
 * checked by the server (real PNG, JPG or PDF, up to 10 MB). Ready files are
 * sent with the message.
 */
export function AttachmentPicker({ threadId, files, setFiles, disabled }: { threadId: string; files: PendingFile[]; setFiles: (f: (cur: PendingFile[]) => PendingFile[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const update = (key: string, patch: Partial<PendingFile>) => setFiles((cur) => cur.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  async function add(list: FileList | null) {
    setNote(null);
    const chosen = [...(list ?? [])];
    if (input.current) input.current.value = "";
    const room = MAX_ATTACHMENTS_PER_MESSAGE - files.filter((f) => !f.error).length;
    if (chosen.length > room) setNote(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to a message.`);
    for (const file of chosen.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const bad = !claimedType(file.name, file.type) ? "Only PNG, JPG and PDF files." : file.size > MAX_ATTACHMENT_BYTES ? "Larger than 10 MB." : file.size === 0 ? "The file is empty." : null;
      setFiles((cur) => [...cur, { key, name: file.name, size: file.size, progress: 0, ...(bad ? { error: bad } : {}) }]);
      if (bad) continue;
      try {
        const { attachmentId, upload } = await postJson(`/api/messages/${threadId}/attachments`, { filename: file.name, size: file.size, contentType: file.type });
        await putWithProgress(upload.url, file, upload.headers, (p) => update(key, { progress: Math.min(99, p) }), new AbortController().signal);
        await postJson(`/api/messages/attachments/${attachmentId}/complete`);
        update(key, { id: attachmentId, progress: 100 });
      } catch (err) {
        update(key, { error: err instanceof Error ? err.message : "Upload failed." });
      }
    }
  }

  async function remove(f: PendingFile) {
    setFiles((cur) => cur.filter((x) => x.key !== f.key));
    if (f.id) await fetch(`/api/messages/attachments/${f.id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-surface-2 focus-within:outline focus-within:outline-2 focus-within:outline-focus">
          <span aria-hidden="true">📎</span> Attach a file
          <input ref={input} type="file" accept={ATTACHMENT_ACCEPT} multiple className="sr-only" disabled={disabled} onChange={(e) => add(e.target.files)} aria-describedby="attach-hint" />
        </label>
        <span id="attach-hint" className="ml-2 text-xs text-muted">
          PNG, JPG or PDF, up to 10 MB
        </span>
      </div>
      {note && <p className="text-xs text-danger">{note}</p>}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5">
              <span className="min-w-0 break-all font-medium">{f.name}</span>
              <span className="text-xs text-muted">{formatBytes(f.size)}</span>
              {f.error ? <span className="text-xs text-danger">{f.error}</span> : f.id ? <span className="text-xs text-success">Ready</span> : <span className="text-xs text-muted" role="status">Uploading… {Math.round(f.progress)}%</span>}
              <button type="button" onClick={() => remove(f)} className="ml-auto text-xs text-primary underline" aria-label={`Remove ${f.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
