import { splitHighlights } from "@/lib/search/query";

/** A search result excerpt with the matching words marked. Rendered as text, never as HTML. */
export function Snippet({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitHighlights(text).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-warning-bg px-0.5 text-text">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
