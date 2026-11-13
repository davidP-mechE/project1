"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Whether this account is "SAT only, no AI" (Admin → Program access). Set once
 * in the app layout; AI controls (the tutor, generate and regenerate, new
 * questions, AI grading) read it and show NoAiNote instead. The server refuses
 * these accounts anyway (src/server/limits.ts assertAiAllowed); this only keeps
 * the screens honest.
 */
const NoAiContext = createContext(false);

export function AiAccessProvider({ noAi, children }: { noAi: boolean; children: ReactNode }) {
  return <NoAiContext.Provider value={noAi}>{children}</NoAiContext.Provider>;
}

export const useNoAi = () => useContext(NoAiContext);

/** Shown where an AI control would be. */
export function NoAiNote({ children = "AI features aren't available on your account.", className }: { children?: ReactNode; className?: string }) {
  return <p className={cn("rounded-md border-[1.5px] border-dashed border-border px-3 py-1.5 text-sm text-muted", className)}>{children}</p>;
}
