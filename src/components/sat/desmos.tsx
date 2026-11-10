"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Calc = { destroy: () => void; observeEvent: (e: string, cb: () => void) => void };
declare global {
  interface Window {
    Desmos?: { GraphingCalculator: (el: HTMLElement, opts: object) => Calc };
  }
}

let loading: Promise<void> | null = null;
function loadDesmos(apiKey: string) {
  if (window.Desmos) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Desmos didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The Desmos graphing calculator, as on the digital SAT. With an API key it
 * opens in the page and reports when it's actually used; without one, it
 * links to desmos.com and can only report that it was opened.
 */
export function DesmosButton({ apiKey, onUse }: { apiKey: string | null; onUse: () => void }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !apiKey || !box.current) return;
    let calc: Calc | null = null;
    let cancelled = false;
    loadDesmos(apiKey)
      .then(() => {
        if (cancelled || !box.current || !window.Desmos) return;
        calc = window.Desmos.GraphingCalculator(box.current, { keypad: true, expressions: true, settingsMenu: false });
        calc.observeEvent("change", onUse);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      calc?.destroy();
    };
  }, [open, apiKey, onUse]);

  if (!apiKey || failed) {
    return (
      <a href="https://www.desmos.com/calculator" target="_blank" rel="noopener noreferrer" onClick={onUse} className="inline-flex h-8 items-center rounded-xl border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
        Desmos calculator<span className="sr-only"> (opens in a new tab)</span> ↗
      </a>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide calculator" : "Desmos calculator"}
        </Button>
      </div>
      {open && <div ref={box} className="h-80 w-full overflow-hidden rounded-lg border border-border" aria-label="Desmos graphing calculator" role="application" />}
    </div>
  );
}
