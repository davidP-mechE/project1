"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";

/** Search form; the query lives in the URL (?q=…) so results can be bookmarked and the back button works. */
export function SearchBox({ courseId, initial }: { courseId: string; initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(() => router.push(`/courses/${courseId}/search?q=${encodeURIComponent(q.trim())}`));
      }}
    >
      <label htmlFor="course-search" className="sr-only">
        Search this course
      </label>
      <input
        id="course-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={200}
        autoFocus={!initial}
        placeholder={'Search lessons and the book, e.g. ohm law, "kirchhoff\'s law", resistor -parallel'}
        className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
      />
      <Button type="submit" disabled={pending || !q.trim()}>
        {pending ? <Spinner label="Searching" /> : "Search"}
      </Button>
    </form>
  );
}
