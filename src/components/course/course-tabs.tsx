"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Overview / Outline / Settings tabs at the top of a course. */
export function CourseTabs({ courseId }: { courseId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/courses/${courseId}`, label: "Overview" },
    { href: `/courses/${courseId}/outline`, label: "Outline" },
    { href: `/courses/${courseId}/setup`, label: "Settings" },
  ];
  return (
    <nav aria-label="Course sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm",
              active ? "border-primary font-medium text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
