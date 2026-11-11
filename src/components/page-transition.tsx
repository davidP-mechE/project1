"use client";

import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

/**
 * A gentle fade-and-rise between pages (React's <ViewTransition> + the
 * browser's View Transitions API). Keyed by the path, so it plays when you go
 * to another page but not when the same page refreshes its data (saving,
 * grading, search results). Browsers without support just switch instantly,
 * and it's turned off for people who ask for reduced motion (globals.css).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
      <div className="page-flow">{children}</div>
    </ViewTransition>
  );
}
