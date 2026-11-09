"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { setTimeZoneAction } from "@/server/actions/review";
import { cn } from "@/lib/utils";

// Settings is also in the account menu, so it's hidden here on phones to make room.
const links = [
  { href: "/dashboard", label: "Today", phone: true },
  { href: "/library", label: "Library", phone: true },
  { href: "/review", label: "Review", phone: true },
  { href: "/settings", label: "Settings", phone: false },
];

/** Main navigation. `dueCount` = flashcards waiting today (shown as a badge on Review). */
export function AppNav({ dueCount = 0, timeZone }: { dueCount?: number; timeZone?: string }) {
  const pathname = usePathname();

  // "Today" (daily card limits, later streaks) should be the student's day: save the browser's time zone once.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && timeZone && tz !== timeZone) void setTimeZoneAction(tz);
  }, [timeZone]);

  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors sm:px-3",
              l.phone ? "inline-flex" : "hidden sm:inline-flex",
              active ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
            )}
          >
            {l.label}
            {l.href === "/review" && dueCount > 0 && (
              <span className="pop-in rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-text" aria-label={`${dueCount} cards to review`}>
                {dueCount > 99 ? "99+" : dueCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
