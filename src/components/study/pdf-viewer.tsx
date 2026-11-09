"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useSourceKind } from "@/components/course/source-kind";
import { sourceNoun, unitWord } from "@/lib/source-label";

/**
 * The original book, one page at a time, rendered with pdf.js in the browser.
 * The PDF is fetched in pieces (HTTP range requests), so opening page 300 of a
 * big book doesn't download the whole file first.
 * Loaded only when the student opens the book (see study-shell.tsx).
 */

type Props = { bookId: string; page: number; onPageChange: (page: number) => void; onClose: () => void };

const ZOOMS = [0.75, 1, 1.25, 1.5, 2, 3];

export default function PdfViewer({ bookId, page, onPageChange, onClose }: Props) {
  const kind = useSourceKind();
  const noun = sourceNoun(kind);
  const Unit = kind === "SLIDES" ? "Slide" : "Page";
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(1);
  const [width, setWidth] = useState(0);
  const [pageInput, setPageInput] = useState(String(page));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<RenderTask | null>(null);

  // Open the document once per book.
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy(): Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const task = (loading = pdfjs.getDocument({
          url: `/api/books/${encodeURIComponent(bookId)}/file`,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          iccUrl: "/pdfjs/iccs/",
          disableAutoFetch: true, // only fetch the parts of the file needed for the pages shown
          rangeChunkSize: 256 * 1024,
        }));
        const loaded = await task.promise;
        if (!cancelled) setDoc(loaded);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(`The ${noun} couldn't be opened here. Try opening it in a new tab instead.`);
      }
    })();
    return () => {
      cancelled = true;
      void loading?.destroy(); // closes the document and its worker
    };
  }, [bookId, noun]);

  // Re-render when the panel is resized.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageCount = doc?.numPages ?? 0;
  const current = pageCount ? Math.min(Math.max(1, page), pageCount) : page;

  // Keep the page box in sync when the page changes from elsewhere (buttons, citations).
  const [shownPage, setShownPage] = useState(current);
  if (shownPage !== current) {
    setShownPage(current);
    setPageInput(String(current));
  }

  useEffect(() => {
    if (!doc || !width || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        const p = await doc.getPage(current);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const cssScale = ((width - 16) / base.width) * ZOOMS[zoomIndex];
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = p.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current!;
        taskRef.current?.cancel();
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = p.render({ canvas, viewport });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) {
          setRendering(false);
          scrollRef.current?.scrollTo({ top: 0 });
        }
      } catch (err) {
        if ((err as Error)?.name === "RenderingCancelledException") return;
        console.error(err);
        if (!cancelled) {
          setRendering(false);
          setError(`This ${unitWord(kind)} couldn't be shown.`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, current, width, zoomIndex, kind]);

  const go = useCallback(
    (n: number) => {
      if (!pageCount) return;
      setError(null);
      onPageChange(Math.min(Math.max(1, n), pageCount));
    },
    [onPageChange, pageCount],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "ArrowLeft" || e.key === "PageUp") go(current - 1);
    else if (e.key === "ArrowRight" || e.key === "PageDown") go(current + 1);
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
  };

  return (
    <section aria-label={kind === "SLIDES" ? "Original slides" : "Original book"} className="flex h-full flex-col bg-surface" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-sm">
        <Button variant="ghost" size="sm" onClick={() => go(current - 1)} disabled={!pageCount || current <= 1} aria-label="Previous page">
          ‹
        </Button>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pageInput);
            if (Number.isInteger(n)) go(n);
          }}
        >
          <label htmlFor="book-page" className="sr-only">
            {Unit} number
          </label>
          <input
            id="book-page"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={() => setPageInput(String(current))}
            className="h-8 w-14 rounded-md border border-border bg-surface px-2 text-center tabular-nums"
          />
          <span className="text-muted" aria-live="polite">
            {pageCount ? `of ${pageCount}` : ""}
          </span>
        </form>
        <Button variant="ghost" size="sm" onClick={() => go(current + 1)} disabled={!pageCount || current >= pageCount} aria-label="Next page">
          ›
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="sm" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0} aria-label="Zoom out">
          −
        </Button>
        <span className="w-11 text-center text-xs tabular-nums text-muted">{Math.round(ZOOMS[zoomIndex] * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIndex === ZOOMS.length - 1} aria-label="Zoom in">
          +
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <a
            href={`/api/books/${encodeURIComponent(bookId)}/file#page=${current}`}
            target="_blank"
            rel="noopener"
            className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            New tab ↗
          </a>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={`Close the ${noun}`}>
            ✕
          </Button>
        </div>
      </div>
      <div ref={scrollRef} className="relative flex-1 overflow-auto bg-surface-2 p-2" tabIndex={0} role="region" aria-label={`${Unit} ${current}`}>
        {error ? (
          <p role="alert" className="m-4 rounded-lg bg-danger-bg p-3 text-sm text-danger">
            {error}
          </p>
        ) : (
          <>
            {(rendering || !doc) && (
              <div className="absolute inset-x-0 top-8 flex justify-center text-muted">
                <Spinner label={`Loading ${unitWord(kind)}`} />
              </div>
            )}
            <canvas ref={canvasRef} className="mx-auto block bg-white shadow-sm" aria-hidden />
          </>
        )}
      </div>
    </section>
  );
}
