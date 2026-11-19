import { formatBytes } from "@/lib/upload/limits";
import { isImage } from "@/lib/files/sniff";
import { cn } from "@/lib/utils";

/** Files on a sent message: images shown inline (click for full size), PDFs as a link. Served through the access-checked route. */
export function AttachmentList({ files, mine }: { files: { id: string; filename: string; contentType: string; sizeBytes: number }[]; mine: boolean }) {
  if (!files.length) return null;
  return (
    <ul className={cn("mt-1 flex max-w-[85%] flex-col gap-2", mine ? "items-end" : "items-start")} aria-label="Attachments">
      {files.map((f) => {
        const url = `/api/messages/attachments/${f.id}`;
        return (
          <li key={f.id}>
            {isImage(f.contentType) ? (
              <a href={url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, access-checked file; not for the image optimizer */}
                <img src={url} alt={f.filename} loading="lazy" className="max-h-64 max-w-full object-contain" />
              </a>
            ) : (
              <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text underline">
                <span aria-hidden="true">📄</span>
                {f.filename}
                <span className="text-xs text-muted no-underline">PDF, {formatBytes(f.sizeBytes)}</span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
