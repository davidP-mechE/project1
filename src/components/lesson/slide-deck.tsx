"use client";

import { useEffect, useRef, useState } from "react";
import { SLIDE_BASE_CSS } from "@/lib/slides/slide-css";

/**
 * A lesson's own slides, shown one under another at the width of the lesson
 * column. Each slide is a fixed 1920×1080 canvas scaled down to fit. The HTML
 * was cleaned on the server (sanitizeSlideHtml) before it reached here.
 */
export function SlideDeck({ slides, firstPage }: { slides: { id: string; html: string }[]; firstPage: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 1920);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <style>{SLIDE_BASE_CSS}</style>
      {slides.map((s, i) => (
        <figure key={s.id} className="flex flex-col gap-1.5" aria-label={`Slide ${i + 1} of ${slides.length}`}>
          <div
            ref={i === 0 ? frame : undefined}
            className="relative w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
            style={{ aspectRatio: "16 / 9" }}
          >
            <div className="cb-slide absolute left-0 top-0 origin-top-left" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }} dangerouslySetInnerHTML={{ __html: s.html }} />
          </div>
          <figcaption className="text-xs text-muted">
            Slide {i + 1} of {slides.length} · page {firstPage + i}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
