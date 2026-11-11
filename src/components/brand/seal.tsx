import { cn } from "@/lib/utils";
import { BRAND, badgeText } from "@/lib/brand";

/**
 * Coursebook's mark: an open book in cream on an ink tile, with a gold spine,
 * a gold ribbon and a gold base line. The same drawing is src/app/icon.svg.
 */
export function CoursebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 42 42" className={cn("cb-mark size-9 shrink-0", className)} aria-hidden>
      <rect className="mk-tile" x="1" y="1" width="40" height="40" rx="11" fill="#14213d" stroke="#c9a227" strokeWidth="1.5" />
      <path className="mk-page" d="M21 13.5C17 11 12.5 10.6 8.5 11.6V28.6C12.5 27.6 17 28 21 30.5Z" fill="#f3ead5" />
      <path className="mk-page2" d="M21 13.5C25 11 29.5 10.6 33.5 11.6V28.6C29.5 27.6 25 28 21 30.5Z" fill="#fbf5e6" />
      <path className="mk-lines" d="M11.5 16.4C14 15.9 16.6 16.2 18.6 17.2M11.5 20C14 19.5 16.6 19.8 18.6 20.8M11.5 23.6C14 23.1 16.6 23.4 18.6 24.4" stroke="#14213d" strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path className="mk-gold-s" d="M21 13.5V30.5" stroke="#c9a227" strokeWidth="1.6" />
      <path className="mk-gold" d="M27.2 11.4V19.6L29 18 30.8 19.6V11.1" fill="#c9a227" />
      <path className="mk-gold-s" d="M7 32.6C12 31 17 31.4 21 33.8 25 31.4 30 31 35 32.6" stroke="#c9a227" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Mark plus "Coursebook". Its visible text is the link's name, so no aria-label is needed. */
export function Wordmark({ className, onDark = true, size = "md" }: { className?: string; onDark?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <CoursebookMark className={size === "lg" ? "size-12" : undefined} />
      <span className={cn("font-display font-semibold tracking-tight", size === "lg" ? "text-2xl" : "text-xl", onDark ? "text-nav-text" : "text-text")}>{BRAND.name}</span>
    </span>
  );
}

/**
 * A program's badge: a double gold ring around its badge text (The 1600
 * Project's reads "1600"). Shown next to the program's name on its classes,
 * dashboard and public page; never as the site's logo.
 */
export function ProgramBadge({ program, className, onDark = false }: { program: { name: string; badge?: string | null }; className?: string; onDark?: boolean }) {
  const text = badgeText(program);
  const size = text.length >= 4 ? 10.2 : text.length === 3 ? 11.5 : 14;
  return (
    <svg viewBox="0 0 42 42" className={cn("size-9 shrink-0", className)} aria-hidden>
      <circle cx="21" cy="21" r="19.5" fill={onDark ? "#14213d" : "#14213d"} stroke="#c9a227" strokeWidth="2" />
      <circle cx="21" cy="21" r="15.5" fill="none" stroke="#c9a227" strokeWidth="0.8" />
      <text x="21" y={21 + size * 0.36} textAnchor="middle" fontFamily="'Fraunces Variable', Georgia, serif" fontWeight="700" fontSize={size} fill="#f3ead5">
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
