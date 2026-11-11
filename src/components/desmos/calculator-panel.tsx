"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DesmosGraph, type DesmosHandle } from "./desmos-graph";
import { cn } from "@/lib/utils";

const read = (k: string) => {
  try {
    const v = sessionStorage.getItem(k);
    return v ? (JSON.parse(v) as object) : null;
  } catch {
    return null;
  }
};

/**
 * The calculator panel for math lessons, practice sets and test screens: a
 * toggle opens a full Desmos graphing calculator in a resizable side panel
 * (desktop) or a bottom sheet (phone). Its graph is kept between questions for
 * the same `storageKey` (one practice sitting) and starts blank for a new one.
 * Not rendered at all when `byHand` is set (a "by hand only" assignment).
 */
export function CalculatorPanel({ apiKey, storageKey, byHand = false, onUse }: { apiKey: string | null; storageKey: string; byHand?: boolean; onUse?: () => void }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [width, setWidth] = useState(440);
  const graph = useRef<DesmosHandle>(null);
  const key = `desmos:${storageKey}`;
  const [initial] = useState(() => (typeof window === "undefined" ? null : read(key)));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) setTimeout(() => graph.current?.resize(), 0);
  }, [open, width]);

  if (byHand) return null;

  const onChange = () => {
    onUse?.();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = graph.current?.getState();
      try {
        if (s) sessionStorage.setItem(key, JSON.stringify(s));
      } catch {
        // Storage full or blocked: the graph still lasts while the page is open.
      }
    }, 500);
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(300, Math.min(window.innerWidth * 0.7, startW + (startX - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      <Button
        size="sm"
        variant={open ? "primary" : "secondary"}
        aria-expanded={open}
        aria-controls="calculator-panel"
        onClick={() => {
          setOpen(!open);
          setOpened(true);
          onUse?.();
        }}
      >
        {open ? "Hide calculator" : "Calculator"}
      </Button>
      {opened && (
        <aside
          id="calculator-panel"
          aria-label="Graphing calculator"
          hidden={!open}
          style={{ ["--panel-w" as string]: `${width}px` }}
          className={cn(
            "fixed inset-x-0 bottom-16 z-40 flex h-[60dvh] flex-col border-t border-border bg-surface shadow-2xl",
            "lg:inset-x-auto lg:right-0 lg:top-0 lg:bottom-0 lg:h-auto lg:w-[var(--panel-w)] lg:border-l lg:border-t-0",
          )}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the calculator"
            onPointerDown={startDrag}
            className="absolute inset-y-0 left-0 hidden w-2 -translate-x-1 cursor-col-resize hover:bg-focus/30 lg:block"
          />
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Desmos calculator</p>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
          <DesmosGraph ref={graph} apiKey={apiKey} initialState={initial} onChange={onChange} className="h-full flex-1 rounded-none border-0" />
        </aside>
      )}
    </>
  );
}
