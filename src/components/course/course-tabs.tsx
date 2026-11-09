"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Course tabs. The study tabs (Flashcards, Notes, Search) appear once lessons are being written. */
export function CourseTabs({ courseId, study }: { courseId: string; study: boolean }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On phones the tab row scrolls sideways: keep the current tab in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  const tabs = [
    { href: `/courses/${courseId}`, label: "Overview" },
    { href: `/courses/${courseId}/outline`, label: "Outline" },
    { href: `/courses/${courseId}/setup`, label: "Settings" },
    ...(study
      ? [
          { href: `/courses/${courseId}/plan`, label: "Plan" },
          { href: `/courses/${courseId}/flashcards`, label: "Flashcards" },
          { href: `/courses/${courseId}/notes`, label: "Notes" },
          { href: `/courses/${courseId}/search`, label: "Search" },
          { href: `/courses/${courseId}/tutor`, label: "Ask the book" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Course sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            ref={active ? activeRef : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press-soft -mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
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
