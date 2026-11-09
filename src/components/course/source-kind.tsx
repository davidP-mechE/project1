"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SourceKindName } from "@/lib/source-label";

/** Whether the current course comes from a textbook or a slide deck (set by the course layout). */
const SourceKindContext = createContext<SourceKindName>("BOOK");

export function SourceKindProvider({ kind, children }: { kind: SourceKindName; children: ReactNode }) {
  return <SourceKindContext.Provider value={kind}>{children}</SourceKindContext.Provider>;
}

export const useSourceKind = () => useContext(SourceKindContext);
