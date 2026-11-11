"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BookLoader } from "@/components/ui/book-loader";
import { cn } from "@/lib/utils";
import { useSourceKind } from "@/components/course/source-kind";

/**
 * The lesson page layout: course sidebar | lesson | (optional) the original
 * book side by side. Any link with data-book-page (page references and
 * "(p. 47)" citations) opens the book panel at that page instead of a new tab.
 * On phones the book opens full screen over the lesson.
 */

const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted">
      <BookLoader label="Opening" showLabel />
    </div>
  ),
});

type BookCtx = { openBook: (page: number) => void; bookOpen: boolean };
const BookContext = createContext<BookCtx | null>(null);
export const useBook = () => useContext(BookContext);

export function StudyShell({ bookId, sidebar, children, initialPage = null }: { bookId: string; sidebar: ReactNode; children: ReactNode; initialPage?: number | null }) {
  const kind = useSourceKind();
  // ?book=N (e.g. from search results) opens the book at that page.
  const [page, setPage] = useState<number | null>(initialPage);
  const open = page !== null;
  const openBook = useCallback((p: number) => setPage(Math.max(1, Math.floor(p))), []);
  const close = useCallback(() => setPage(null), []);

  // On phones the book covers the page; stop the lesson behind it from scrolling.
  useEffect(() => {
    if (!open || window.matchMedia("(min-width: 1024px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onClickCapture = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-book-page]");
    if (!link) return;
    const n = Number(link.dataset.bookPage);
    if (!Number.isInteger(n) || n < 1) return;
    e.preventDefault();
    openBook(n);
  };

  return (
    <BookContext.Provider value={{ openBook, bookOpen: open }}>
      <div className={cn("grid gap-6 lg:gap-8", open ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "lg:grid-cols-[15rem_minmax(0,1fr)]")}>
        {/* One sidebar: a column on desktop (hidden while the book is open), a collapsible list above the lesson on phones. */}
        <div className={cn("min-w-0", open && "lg:hidden")}>{sidebar}</div>
        <div onClickCapture={onClickCapture} className={cn("min-w-0", !open && "lg:max-w-3xl")}>
          {children}
        </div>
        {open && (
          <aside
            className="fixed inset-0 z-30 flex flex-col bg-surface lg:sticky lg:inset-auto lg:top-22 lg:z-auto lg:h-[calc(100dvh-7rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-border"
            aria-label={kind === "SLIDES" ? "Slide viewer" : "Book viewer"}
          >
            <PdfViewer bookId={bookId} page={page} onPageChange={setPage} onClose={close} />
          </aside>
        )}
      </div>
    </BookContext.Provider>
  );
}

/** "Show the book" button for the lesson header. */
export function OpenBookButton({ page, label }: { page: number; label: string }) {
  const book = useBook();
  if (!book) return null;
  return (
    <button
      type="button"
      onClick={() => book.openBook(page)}
      className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
      aria-pressed={book.bookOpen}
    >
      <span aria-hidden>📖</span> {label}
    </button>
  );
}
