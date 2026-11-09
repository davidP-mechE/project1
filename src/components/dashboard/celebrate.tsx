"use client";

import { useEffect, useState } from "react";

const COLORS = ["var(--primary)", "var(--success)", "var(--warning)", "#f472b6", "#60a5fa"];

/**
 * A short confetti burst the first time you see the dashboard after reaching
 * your daily goal (once a day), or hitting a streak milestone (3, 7, 14, 30…).
 * Pure CSS, removed after it plays; skipped for people who prefer reduced motion.
 */
export function Celebrate({ goalMet, streak, today }: { goalMet: boolean; streak: number; today: string }) {
  const [pieces, setPieces] = useState<{ left: number; delay: number; color: string; rot: number; drift: number }[]>([]);

  useEffect(() => {
    const milestone = [3, 7, 14, 30, 50, 100, 200, 365].includes(streak);
    if (!goalMet && !milestone) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const key = `cb-celebrated-${today}-${goalMet ? "goal" : ""}${milestone ? `streak${streak}` : ""}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* private mode: celebrate anyway */
    }
    const timer = setTimeout(() => {
      setPieces(
        Array.from({ length: 70 }, (_, i) => ({
          left: Math.random() * 100,
          delay: Math.random() * 400,
          color: COLORS[i % COLORS.length],
          rot: Math.random() * 720 - 360,
          drift: Math.random() * 120 - 60,
        })),
      );
    }, 250);
    const clear = setTimeout(() => setPieces([]), 3200);
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
    };
  }, [goalMet, streak, today]);

  if (pieces.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti absolute top-[-12px] block h-3 w-2 rounded-sm"
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}ms`, ["--rot" as string]: `${p.rot}deg`, ["--drift" as string]: `${p.drift}px` }}
        />
      ))}
    </div>
  );
}
