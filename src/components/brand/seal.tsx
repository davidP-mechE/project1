import { cn } from "@/lib/utils";
import { BRAND, badgeText } from "@/lib/brand";

/**
 * Coursebook's mark: a tiny book cover from the series. A cobalt cover with a
 * darker spine, two white title bars and a pink band along the bottom. The
 * same drawing is src/app/icon.svg.
 */
export function CoursebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 42 42" className={cn("size-9 shrink-0", className)} aria-hidden>
      <rect x="1" y="1" width="40" height="40" rx="6" fill="#2a3bd1" />
      <path d="M1 7a6 6 0 0 1 6-6h3v40H7a6 6 0 0 1-6-6Z" fill="#1a258a" />
      <path d="M10 32h31v3a6 6 0 0 1-6 6H10Z" fill="#ff5c93" />
      <rect x="15" y="9" width="20" height="5" rx="1" fill="#fff" />
      <rect x="15" y="17" width="13" height="5" rx="1" fill="#fff" />
    </svg>
  );
}

/** Mark plus "Coursebook". Its visible text is the link's name, so no aria-label is needed. */
export function Wordmark({ className, onDark = true, size = "md" }: { className?: string; onDark?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <CoursebookMark className={size === "lg" ? "size-12" : undefined} />
      <span className={cn("font-display font-extrabold tracking-tight", size === "lg" ? "text-2xl" : "text-xl", onDark ? "text-nav-text" : "text-text")}>{BRAND.name}</span>
    </span>
  );
}

/**
 * A program's badge: a double gold ring on navy around its badge text (The
 * 1600 Project's reads "1600"). It is the program's own identity, so it keeps
 * its colours whatever Coursebook's look. Shown next to the program's name on
 * its classes, dashboard and public page; never as the site's logo.
 */
export function ProgramBadge({ program, className, onDark = false }: { program: { name: string; badge?: string | null }; className?: string; onDark?: boolean }) {
  const text = badgeText(program);
  const size = text.length >= 4 ? 10.2 : text.length === 3 ? 11.5 : 14;
  return (
    <svg viewBox="0 0 42 42" className={cn("size-9 shrink-0", className)} aria-hidden>
      <circle cx="21" cy="21" r="19.5" fill="#14213d" stroke="#c9a227" strokeWidth="2" />
      <circle cx="21" cy="21" r="15.5" fill="none" stroke="#c9a227" strokeWidth="0.8" />
      <text x="21" y={21 + size * 0.36} textAnchor="middle" fontFamily="'Archivo Variable', system-ui, sans-serif" fontWeight="800" fontSize={size} fill="#f3ead5">
        {text}
      </text>
    </svg>
  );
}

/** "[badge] The 1600 Project · SAT Fall": a program's identity inside the app. */
export function ProgramTag({ program, className: cls, detail }: { program: { name: string; badge?: string | null }; className?: string; detail?: string | null }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", cls)}>
      <ProgramBadge program={program} className="size-7" />
      <span>
        <span className="font-display font-semibold">{program.name}</span>
        {detail && <span className="text-muted"> · {detail}</span>}
      </span>
    </span>
  );
}
