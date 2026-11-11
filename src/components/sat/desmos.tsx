"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DesmosFallback, DesmosGraph } from "@/components/desmos/desmos-graph";

/**
 * The Desmos graphing calculator inline under a question (diagnostics, mistake
 * review), built on the shared DesmosGraph. Without a key it shows the link to
 * desmos.com and can only report that it was opened.
 */
export function DesmosButton({ apiKey, onUse }: { apiKey: string | null; onUse: () => void }) {
  const [open, setOpen] = useState(false);
  if (!apiKey) {
    return (
      <span onClickCapture={onUse}>
        <DesmosFallback reason="nokey" />
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide calculator" : "Desmos calculator"}
        </Button>
      </div>
      {open && <DesmosGraph apiKey={apiKey} onChange={onUse} />}
    </div>
  );
}
