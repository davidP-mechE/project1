"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { bookPageHref } from "@/components/lesson/cite-pages";
import { Button, ButtonLink } from "@/components/ui/button";
import { ProgressBar, Spinner } from "@/components/ui/misc";
import { burst } from "@/components/ui/burst";
import { reviewCardAction } from "@/server/actions/review";
import { RATINGS, type ReviewRating } from "@/lib/srs/fsrs";
import { LEARN_AHEAD_MS } from "@/lib/srs/queue";
import { cn } from "@/lib/utils";
import type { ReviewItem } from "@/server/srs";

const RATING_STYLE: Record<ReviewRating, string> = {
  1: "border-danger/40 hover:bg-danger-bg",
  2: "border-warning/40 hover:bg-warning-bg",
  3: "border-success/40 hover:bg-success-bg",
  4: "border-primary/40 hover:bg-primary/10",
};

/**
 * One review session: show the front, reveal the back, rate it.
 * Keyboard: Space/Enter to reveal, 1–4 to rate. Cards rated "Again" (or still
 * being learned) come back later in the same session when they're due.
 */
export function ReviewSession({
  items,
  backHref,
}: {
  items: ReviewItem[];
  backHref: string;
}) {
  const [queue, setQueue] = useState(items);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState({ reviewed: 0, again: 0 });
  const shownAt = useRef(0);
  const card = queue[0];

  useEffect(() => {
    shownAt.current = performance.now();
  }, [card?.flashcardId, queue.length]);

  const rate = useCallback(
    async (rating: ReviewRating) => {
      if (!card || pending) return;
      setPending(true);
      setError(null);
      const res = await reviewCardAction(
        card.flashcardId,
        rating,
        Math.round(performance.now() - shownAt.current),
      );
      setPending(false);
      if (!res.ok) return setError(res.error);
      setDone((d) => ({
        reviewed: d.reviewed + 1,
        again: d.again + (rating === 1 ? 1 : 0),
      }));
      if (
        queue.length === 1 &&
        new Date(res.due).getTime() - Date.now() > LEARN_AHEAD_MS
      )
        burst(null, { count: 40, spread: 160 }); // session finished
      setRevealed(false);
      setQueue(([, ...rest]) => {
        const comesBack =
          new Date(res.due).getTime() - Date.now() <= LEARN_AHEAD_MS;
        if (!comesBack) return rest;
        // Show it again after a few other cards (or right away if it's the last one).
        const again = {
          ...card,
          state: res.state as ReviewItem["state"],
          intervals: res.intervals,
        };
        const at = Math.min(rest.length, rating === 1 ? 3 : 6);
        return [...rest.slice(0, at), again, ...rest.slice(at)];
      });
    },
    [card, pending, queue.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "BUTTON", "A"].includes(e.target.tagName) &&
        e.key !== "1" &&
        e.key !== "2" &&
        e.key !== "3" &&
        e.key !== "4"
      )
        return;
      if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as ReviewRating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, revealed, rate]);

  if (!card) {
    return (
      <div className="pop-in flex flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-14 text-center">
        <p className="text-3xl" aria-hidden>
          🎉
        </p>
        <h2 className="text-xl font-semibold">
          {done.reviewed > 0
            ? "All done for now!"
            : "Nothing to review right now"}
        </h2>
        <p className="max-w-md text-sm text-muted">
          {done.reviewed > 0
            ? `You reviewed ${done.reviewed} ${done.reviewed === 1 ? "card" : "cards"}. Cards come back just before you're likely to forget them, so check in again tomorrow.`
            : "New cards appear here once you've opened the lessons they come from, and old ones when they're due again."}
        </p>
        <ButtonLink href={backHref} variant="secondary">
          Back
        </ButtonLink>
      </div>
    );
  }

  const remaining = queue.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <ProgressBar
          value={
            (done.reviewed / Math.max(1, done.reviewed + queue.length)) * 100
          }
          label="Review progress"
        />
        <p className="text-xs text-muted" aria-live="polite">
          {remaining} {remaining === 1 ? "card" : "cards"} left ·{" "}
          {done.reviewed} reviewed
          {card.state === "NEW" && " · new card"}
        </p>
      </div>

      {/* The card flips over to show the answer. Keyed by card, so the next card starts face up without flipping back. */}
      <section
        key={card.flashcardId}
        aria-label="Flashcard"
        className="flip-card"
        data-flipped={revealed}
      >
        <div className="flip-inner">
          <div
            className="index-card flip-face flex min-h-72 flex-col p-6"
            inert={revealed}
          >
            <p className="text-xs text-muted">
              <Link
                href={`/courses/${card.courseId}/lessons/${card.lessonId}`}
                className="hover:text-text hover:underline"
              >
                {card.courseTitle} · {card.lessonTitle}
              </Link>
            </p>
            <div className="mt-4 text-lg">
              <Markdown className="[&_p]:m-0">{card.front}</Markdown>
            </div>
            <p className="mt-auto pt-6 text-center text-xs text-muted">
              Think of the answer, then flip the card.
            </p>
          </div>
          <div
            className="index-card index-card-back flip-face flip-back flex min-h-72 flex-col p-6"
            inert={!revealed}
          >
            <div className="text-sm text-muted">
              <Markdown className="[&_p]:m-0">{card.front}</Markdown>
            </div>
            <div className="mt-4 border-t border-border pt-4 text-lg">
              <Markdown className="[&_p]:m-0">{card.back}</Markdown>
              {card.pageRefs.length > 0 && (
                <p className="mt-4 flex flex-wrap items-center gap-1 text-xs text-muted">
                  In the {card.sourceKind === "SLIDES" ? "slides" : "book"}:
                  {card.pageRefs.map((p) => (
                    <a
                      key={p}
                      href={bookPageHref(card.bookId, p)}
                      target="_blank"
                      rel="noopener"
                      className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-text hover:underline"
                    >
                      {card.sourceKind === "SLIDES" ? "slide" : "p."} {p}
                    </a>
                  ))}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {!revealed ? (
        <Button
          onClick={() => setRevealed(true)}
          className="h-12 text-base"
          autoFocus
        >
          Show answer{" "}
          <kbd className="ml-2 hidden rounded border border-current/30 px-1.5 text-xs opacity-80 sm:inline">
            Space
          </kbd>
        </Button>
      ) : (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="group"
          aria-label="How well did you remember it?"
        >
          {RATINGS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => rate(r.value)}
              disabled={pending}
              className={cn(
                "press flex flex-col items-center gap-0.5 rounded-xl border bg-surface px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-60",
                RATING_STYLE[r.value],
              )}
            >
              <span>
                {r.label}{" "}
                <kbd className="ml-1 hidden text-xs text-muted sm:inline">
                  {r.key}
                </kbd>
              </span>
              <span className="text-xs font-normal text-muted">
                {card.intervals[r.value]}
              </span>
            </button>
          ))}
        </div>
      )}
      {pending && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Spinner /> Saving…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-center text-xs text-muted">
        Again = forgot · Hard = remembered with effort · Good = remembered ·
        Easy = instant
      </p>
    </div>
  );
}
