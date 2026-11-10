import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * The 1600 Project seal: a double gold ring around "1600". Used as the logo,
 * the favicon (src/app/icon.svg) and on printed reports.
 */
export function Seal({ className, onDark = true }: { className?: string; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 42 42" className={cn("size-9 shrink-0", className)} aria-hidden>
      <circle cx="21" cy="21" r="19.5" fill={onDark ? "#14213d" : "#fffdf8"} stroke="#c9a227" strokeWidth="2" />
      <circle cx="21" cy="21" r="15.5" fill="none" stroke="#c9a227" strokeWidth="0.8" />
      <text x="21" y="25.2" textAnchor="middle" fontFamily="'Fraunces Variable', Georgia, serif" fontWeight="700" fontSize="11.5" fill={onDark ? "#f3ead5" : "#14213d"}>
        1600
      </text>
    </svg>
  );
}

/** Seal plus "THE / 1600 Project". */
export function Wordmark({ className, onDark = true, size = "md" }: { className?: string; onDark?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Seal onDark={onDark} className={size === "lg" ? "size-12" : undefined} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display text-[0.65rem] font-semibold tracking-[0.2em]", onDark ? "text-[#d9b84a]" : "text-accent-ink")}>THE</span>
        <span className={cn("font-display font-semibold tracking-tight", size === "lg" ? "text-2xl" : "text-lg", onDark ? "text-nav-text" : "text-text")}>{BRAND.short}</span>
      </span>
    </span>
  );
}
