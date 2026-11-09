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
          className={cn("press rounded-full border px-3 py-1", i.active ? "border-primary bg-primary/10 font-semibold" : "border-border bg-surface hover:bg-surface-2")}
        >
          {i.label}
          {i.count !== undefined && <span className="ml-1 text-muted">({i.count})</span>}
        </Link>
      ))}
    </nav>
  );
}
