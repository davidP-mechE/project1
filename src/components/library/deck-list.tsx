"use client";

import { formatBytes } from "@/lib/upload/limits";

/**
 * The decks chosen for a slide collage, in the order they'll appear in the
 * course (each becomes a unit). They can be moved up or down, or removed.
 */
export function DeckList({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const move = (i: number, by: number) => {
    const next = [...files];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    onChange(next);
  };
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Decks, in course order">
      {files.map((f, i) => (
        <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-muted">{i + 1}.</span>
          <span className="min-w-0 flex-1 truncate" title={f.name}>
            {f.name}
          </span>
          <span className="hidden shrink-0 text-xs text-muted sm:inline">{formatBytes(f.size)}</span>
          <span className="flex shrink-0 gap-0.5">
            <button type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label={`Move ${f.name} up`} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40">
              ↑
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={disabled || i === files.length - 1} aria-label={`Move ${f.name} down`} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40">
              ↓
            </button>
            <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} disabled={disabled} aria-label={`Remove ${f.name}`} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40">
              ✕
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
