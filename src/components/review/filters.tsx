import Link from "next/link";
import { cn } from "@/lib/utils";

/** A row of pill links: "All courses", then one per course (and any extra options). */
export function PillNav({ label, items }: { label: string; items: { href: string; label: string; count?: number; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn("press rounded-md border-[1.5px] px-3.5 py-1.5 font-semibold transition-colors", i.active ? "border-primary bg-primary text-primary-text" : "border-border bg-surface hover:border-text")}
        >
          {i.label}
          {i.count !== undefined && <span className={cn("ml-1", i.active ? "opacity-80" : "text-muted")}>({i.count})</span>}
        </Link>
      ))}
    </nav>
  );
}
