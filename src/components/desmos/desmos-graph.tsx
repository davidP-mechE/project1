"use client";

import { useTheme } from "next-themes";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DESMOS_CALCULATOR_URL, loadDesmos, type DesmosCalculator } from "@/lib/desmos/loader";
import { cn } from "@/lib/utils";

export type DesmosHandle = { getState: () => object | null; setState: (s: object | null) => void; ready: () => boolean; resize: () => void };

/** Shown when there's no API key or the script fails: a short note and a link; the page keeps working. */
export function DesmosFallback({ className, reason }: { className?: string; reason: "nokey" | "failed" }) {
  return (
    <div className={cn("flex flex-col items-start gap-1 rounded-lg border border-dashed border-border bg-surface-2 p-3 text-sm", className)} role="note">
      <p>{reason === "nokey" ? "The built-in graphing calculator isn't set up on this site." : "The graphing calculator couldn't load."}</p>
      <a href={DESMOS_CALCULATOR_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
        Open the Desmos calculator<span className="sr-only"> (opens in a new tab)</span> ↗
      </a>
    </div>
  );
}

type Props = {
  apiKey: string | null;
  /** A saved graph (calculator.getState()) to start from. */
  initialState?: object | null;
  /** "calculator": the full graphing calculator. "check": an embedded graph from a saved state. */
  variant?: "calculator" | "check";
  /** For checks: let the student change it (true) or only look (false). */
  interactive?: boolean;
  className?: string;
  label?: string;
  onChange?: () => void;
};

/**
 * The one Desmos component every feature uses (calculator panel, check blocks,
 * questions, the editor). Loads the API lazily, follows the site's dark mode
 * (Desmos's inverted colors), and only ever gives Desmos the graph itself.
 */
export const DesmosGraph = forwardRef<DesmosHandle, Props>(function DesmosGraph({ apiKey, initialState, variant = "calculator", interactive = true, className, label, onChange }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const calc = useRef<DesmosCalculator | null>(null);
  const [failed, setFailed] = useState(false);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const initial = useRef(initialState ?? null);
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    getState: () => calc.current?.getState() ?? null,
    setState: (s) => (s ? calc.current?.setState(s, { allowUndo: true }) : calc.current?.setBlank()),
    ready: () => Boolean(calc.current),
    resize: () => calc.current?.resize(),
  }));

  useEffect(() => {
    if (!apiKey || !box.current) return;
    let cancelled = false;
    loadDesmos(apiKey)
      .then(() => {
        if (cancelled || !box.current || !window.Desmos) return;
        const locked = variant === "check" && !interactive;
        const c = window.Desmos.GraphingCalculator(box.current, {
          keypad: variant === "calculator",
          expressions: variant === "calculator" || interactive,
          expressionsCollapsed: variant === "check",
          settingsMenu: variant === "calculator",
          zoomButtons: !locked,
          lockViewport: locked,
          readonly: locked,
          border: false,
          invertedColors: dark,
        });
        if (initial.current) c.setState(initial.current);
        c.observeEvent("change", () => change.current?.());
        calc.current = c;
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      calc.current?.destroy();
      calc.current = null;
    };
    // The calculator is created once; theme changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, variant, interactive]);

  useEffect(() => {
    calc.current?.updateSettings({ invertedColors: dark });
  }, [dark]);

  if (!apiKey) return <DesmosFallback reason="nokey" className={className} />;
  if (failed) return <DesmosFallback reason="failed" className={className} />;
  return <div ref={box} className={cn("h-80 w-full overflow-hidden rounded-lg border border-border bg-white", className)} role="application" aria-label={label ?? (variant === "check" ? "Desmos graph" : "Desmos graphing calculator")} />;
});
