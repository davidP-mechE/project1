"use client";

import { useEffect, useState } from "react";

type Preview = { pageNumber: number; label: string | null; start: string; end: string; empty: boolean; textSource: string };

// Shared across all rows so each page is fetched at most once per visit.
const cache = new Map<string, Promise<Preview | null>>();

function load(courseId: string, page: number): Promise<Preview | null> {
  const key = `${courseId}:${page}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`/api/courses/${courseId}/pages/${page}`)
        .then((r) => (r.ok ? (r.json() as Promise<Preview>) : null))
        .catch(() => {
          cache.delete(key);
          return null;
        }),
    );
  }
  return cache.get(key)!;
}

/** Shows how a page begins (or ends), so students can check where a lesson starts and stops. */
export function PagePreview({ courseId, page, which }: { courseId: string; page: number; which: "start" | "end" }) {
  const [state, setState] = useState<{ page: number; data: Preview | null } | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      load(courseId, page).then((data) => alive && setState({ page, data }));
    }, 250); // wait until the student stops typing
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [courseId, page]);

  const loading = !state || state.page !== page;
  const data = loading ? null : state.data;
  const label = which === "start" ? `Page ${page} begins` : `Page ${page} ends`;

  return (
    <figure className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
      <figcaption className="mb-1 font-medium text-muted">
        {label}
        {data?.label && data.label !== String(page) ? ` (printed page ${data.label})` : ""}
      </figcaption>
      {loading ? (
        <p className="animate-pulse text-muted">Loading…</p>
      ) : !data ? (
        <p className="text-muted">Couldn&apos;t load this page.</p>
      ) : data.empty ? (
        <p className="italic text-muted">No text on this page (blank, or a picture).</p>
      ) : (
        <blockquote className="leading-relaxed">
          {which === "start" ? `${data.start}…` : `…${data.end || data.start}`}
        </blockquote>
      )}
    </figure>
  );
}
