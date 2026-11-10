"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  regenerateAllAction,
  startGenerationAction,
} from "@/server/actions/generation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Estimate = {
  lessons: number;
  pages: number;
  costUsd: number;
  minutes: number;
  batch?: boolean;
  quality?: "standard" | "high";
};
const usd = (n: number) =>
  n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`;

/** "Generate course" with a confirmation that shows what it will cost. */
export function GenerateButton({
  courseId,
  estimate,
  label = "Generate course",
  mode = "start",
  disabledReason,
}: {
  courseId: string;
  estimate: Estimate;
  label?: string;
  mode?: "start" | "regenerateAll";
  disabledReason?: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeEdited, setIncludeEdited] = useState(false);
  const [pending, startTransition] = useTransition();

  const go = () =>
    startTransition(async () => {
      setError(null);
      const res =
        mode === "start"
          ? await startGenerationAction(courseId)
          : await regenerateAllAction(courseId, includeEdited);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      dialog.current?.close();
      router.push(`/courses/${courseId}`);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={mode === "start" ? "primary" : "secondary"}
        onClick={() => dialog.current?.showModal()}
        disabled={Boolean(disabledReason) || estimate.lessons === 0}
        title={disabledReason}
      >
        {label}
      </Button>
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      <dialog
        ref={dialog}
        aria-labelledby={`gen-title-${mode}`}
        className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/50"
      >
        <h2 id={`gen-title-${mode}`} className="text-lg font-semibold">
          {mode === "start"
            ? "Generate this course?"
            : "Regenerate all lessons?"}
        </h2>
        <p className="mt-2 text-sm text-muted">
          Claude will write {estimate.lessons}{" "}
          {estimate.lessons === 1 ? "lesson" : "lessons"} from {estimate.pages}{" "}
          pages.{" "}
          {estimate.batch
            ? "They're written together as one batch, which costs half as much, and arrive together, usually within an hour."
            : "You can start studying each lesson as soon as it's ready."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-4 text-sm">
          <div>
            <dt className="text-muted">Estimated API cost</dt>
            <dd className="font-semibold">
              {usd(estimate.costUsd)}
              {estimate.quality === "high" && <span className="block text-xs font-normal text-muted">High quality (change in Setup)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Estimated time</dt>
            <dd className="font-semibold">
              {estimate.batch
                ? "usually under an hour"
                : `about ${estimate.minutes} min`}
            </dd>
          </div>
        </dl>
        {mode === "regenerateAll" && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeEdited}
              onChange={(e) => setIncludeEdited(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              Also replace lessons I edited by hand (your edits will be lost)
            </span>
          </label>
        )}
        {error && (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => dialog.current?.close()}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={go} disabled={pending}>
            {pending
              ? "Starting…"
              : mode === "start"
                ? "Generate"
                : "Regenerate"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
