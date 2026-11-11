"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { DesmosGraph, type DesmosHandle } from "./desmos-graph";

/** A "Desmos check": an embedded graph from a saved state, interactive or locked, with "Reset graph". */
export function DesmosCheck({ apiKey, state, interactive = true, title }: { apiKey: string | null; state: object; interactive?: boolean; title?: string }) {
  const g = useRef<DesmosHandle>(null);
  return (
    <div className="flex flex-col gap-2">
      <DesmosGraph ref={g} apiKey={apiKey} initialState={state} variant="check" interactive={interactive} label={title ?? "Desmos check"} />
      {apiKey && (
        <div>
          <Button size="sm" variant="secondary" onClick={() => g.current?.setState(state)}>
            Reset graph
          </Button>
        </div>
      )}
    </div>
  );
}

/** Under a question's explanation: the saved graph, opened on request. */
export function QuestionDesmosCheck({ apiKey, state }: { apiKey: string | null; state: object }) {
  return (
    <details className="rounded-md border border-border bg-surface p-2 text-text">
      <summary className="cursor-pointer text-sm font-semibold">Show the Desmos check</summary>
      <div className="mt-2">
        <DesmosCheck apiKey={apiKey} state={state} />
      </div>
    </details>
  );
}
