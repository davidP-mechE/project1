"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { bookPageHref } from "@/components/lesson/cite-pages";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { Source, TutorEvent } from "@/server/tutor/chat";

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  status: "STREAMING" | "DONE" | "STOPPED" | "ERROR";
  sources: Source[];
  citedPages: number[];
  notInBook: boolean;
  error: string | null;
  confidence?: "high" | "low" | "none";
};

type Props = {
  courseId: string;
  bookId: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  threadId?: string | null;
  initial?: ChatMessage[];
  /** Where a new conversation's URL goes (the tutor page keeps ?thread= in sync). */
  syncUrl?: boolean;
  disabledReason?: string | null;
  className?: string;
};

const pagesLabel = (s: { pageStart: number; pageEnd: number }) => (s.pageStart === s.pageEnd ? `p. ${s.pageStart}` : `pp. ${s.pageStart}–${s.pageEnd}`);

/** The chat with the tutor: ask, watch the answer stream in, see which pages it came from. */
export function TutorChat({ courseId, bookId, lessonId, lessonTitle, threadId: initialThread = null, initial = [], syncUrl = false, disabledReason, className }: Props) {
  const router = useRouter();
  const [threadId, setThreadId] = useState<string | null>(initialThread);
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the answer as it streams, unless the student scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  const patchLast = (fn: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
    stick.current = true;
    const tempId = `tmp-${Date.now()}`;
    setMessages((ms) => [
      ...ms,
      { id: `${tempId}-q`, role: "USER", content: q, status: "DONE", sources: [], citedPages: [], notInBook: false, error: null },
      { id: tempId, role: "ASSISTANT", content: "", status: "STREAMING", sources: [], citedPages: [], notInBook: false, error: null },
    ]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let createdThread: string | null = null;
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, threadId, lessonId, question: q }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "The tutor couldn't answer. Please try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as TutorEvent;
          if (ev.type === "meta") {
            if (!threadId) createdThread = ev.threadId;
            setThreadId(ev.threadId);
            patchLast((m) => ({ ...m, id: ev.messageId, sources: ev.sources, confidence: ev.confidence }));
          } else if (ev.type === "delta") {
            patchLast((m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === "done") {
            patchLast((m) => ({ ...m, content: ev.content, citedPages: ev.citedPages, notInBook: ev.notInBook, status: ev.status }));
          } else if (ev.type === "error") {
            patchLast((m) => ({ ...m, status: "ERROR", error: ev.message }));
          }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) patchLast((m) => ({ ...m, status: "STOPPED" }));
      else {
        const msg = err instanceof Error ? err.message : "The tutor couldn't answer. Please try again.";
        patchLast((m) => ({ ...m, status: "ERROR", error: msg }));
      }
    } finally {
      setBusy(false);
      abort.current = null;
      if (createdThread && syncUrl) {
        window.history.replaceState(null, "", `/courses/${courseId}/tutor?thread=${createdThread}`);
        router.refresh(); // show it in the conversation list
      }
    }
  }

  const suggestions = lessonTitle
    ? [`Explain "${lessonTitle}" in simple terms`, "What are the most important ideas here?", "Give me an example from the book"]
    : ["What are the main topics of this book?", "Explain the hardest idea in chapter 1", "What formulas should I know?"];

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted">
              Ask anything about {lessonTitle ? `"${lessonTitle}"` : "the book"}. Answers come only from the textbook, with page numbers, and the tutor will say so when the book doesn&apos;t cover something.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} disabled={busy || Boolean(disabledReason)} className="press rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-60">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "USER" ? (
            <div key={m.id} className="pop-in max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-text">
              {m.content}
            </div>
          ) : (
            <Answer key={m.id} m={m} bookId={bookId} />
          ),
        )}
      </div>

      <form
        className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        {error && <p className="text-sm text-danger">{error}</p>}
        <label htmlFor={`tutor-q-${lessonId ?? "course"}`} className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={`tutor-q-${lessonId ?? "course"}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={2}
            maxLength={4000}
            disabled={Boolean(disabledReason)}
            placeholder={disabledReason ?? "Ask about the book… (Enter to send, Shift+Enter for a new line)"}
            className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          />
          {busy ? (
            <Button variant="secondary" onClick={() => abort.current?.abort()} aria-label="Stop the answer">
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim() || Boolean(disabledReason)}>
              Ask
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Answer({ m, bookId }: { m: ChatMessage; bookId: string }) {
  const streaming = m.status === "STREAMING";
  return (
    <div className="flex max-w-full flex-col gap-2 self-start">
      <div className={cn("rounded-2xl rounded-bl-md border border-border bg-surface px-4 py-3", m.notInBook && "border-warning/40")}>
        {m.notInBook && <p className="mb-1 text-xs font-medium text-warning">Not covered in the book</p>}
        {m.content ? (
          <Markdown bookId={bookId}>{m.content}</Markdown>
        ) : streaming ? (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Looking through the book…
          </span>
        ) : null}
        {m.status === "STOPPED" && <p className="mt-2 text-xs text-muted">Stopped.</p>}
        {m.status === "ERROR" && <p className="mt-2 text-sm text-danger">{m.error ?? "Something went wrong."}</p>}
      </div>
      {!streaming && m.sources.length > 0 && !m.notInBook && (
        <p className="flex flex-wrap items-center gap-1 px-1 text-xs text-muted">
          From the book:
          {m.sources.map((s) => (
            <a
              key={s.chunkId}
              href={bookPageHref(bookId, s.pageStart)}
              data-book-page={s.pageStart}
              target="_blank"
              rel="noopener"
              className={cn("rounded px-1.5 py-0.5 tabular-nums hover:text-text hover:underline", m.citedPages.some((p) => p >= s.pageStart && p <= s.pageEnd) ? "bg-primary/10 text-primary" : "bg-surface-2")}
              title={m.citedPages.some((p) => p >= s.pageStart && p <= s.pageEnd) ? "Cited in the answer" : "Read by the tutor"}
            >
              {pagesLabel(s)}
            </a>
          ))}
        </p>
      )}
      {!streaming && m.confidence === "low" && !m.notInBook && <p className="px-1 text-xs text-muted">The book may only touch on this briefly. Check the pages.</p>}
    </div>
  );
}
