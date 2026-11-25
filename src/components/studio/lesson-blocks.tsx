"use client";

import { useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { DesmosGraph, type DesmosHandle } from "@/components/desmos/desmos-graph";
import { recordCheckpointAction } from "@/server/actions/studio";
import { embedUrl, thumbnailUrl, videoRef, type CalloutData, type CheckpointData, type DesmosSteps, type VideoData } from "@/lib/studio/blocks";
import { cn } from "@/lib/utils";

/**
 * Video: a thumbnail, title and "why watch" line first; the player (youtube-nocookie.com, privacy-enhanced
 * mode) loads only when the student clicks, so nothing is sent to YouTube before that.
 */
export function VideoBlock({ data, status }: { data: VideoData; status?: React.ReactNode }) {
  const ref = videoRef(data);
  const [playing, setPlaying] = useState(false);
  if (!ref) return null;
  const thumb = thumbnailUrl(ref);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{data.title}</p>
          {data.whyWatch && <p className="text-sm text-muted">{data.whyWatch}</p>}
        </div>
        {status}
      </div>
      {playing ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <iframe
            src={embedUrl(ref)}
            title={data.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-2 text-left" aria-label={`Play video: ${data.title}${ref.provider === "youtube_playlist" ? " (playlist)" : ""}`}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-sm text-muted">YouTube playlist</span>
          )}
          <span aria-hidden className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-black/70 text-2xl text-white group-hover:bg-black/85">▶</span>
        </button>
      )}
      <p className="text-xs text-muted">
        Plays from YouTube (privacy-enhanced mode).{" "}
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="underline">
          Open on YouTube<span className="sr-only"> (new tab)</span>
        </a>
      </p>
    </Card>
  );
}

export function CalloutBlock({ data }: { data: CalloutData }) {
  const trap = data.variant === "trap";
  return (
    <aside className={cn("flex flex-col gap-1 rounded-lg border-l-4 px-4 py-3", trap ? "border-warning bg-warning-bg" : "border-success bg-success-bg")} aria-label={trap ? "Trap" : "Tip"}>
      <p className={cn("text-sm font-semibold", trap ? "text-warning" : "text-success")}>
        {trap ? "Trap" : "Tip"}
        {data.title ? `: ${data.title}` : ""}
      </p>
      <div className="text-sm text-text">
        <Markdown>{data.content}</Markdown>
      </div>
    </aside>
  );
}

/** Checkpoint: try each, then "Show answer". Not graded; "I got it / I missed it" is saved for the student's own progress. */
export function CheckpointBlock({ blockId, data, initial, canRecord }: { blockId: string; data: CheckpointData; initial?: Record<string, string>; canRecord: boolean }) {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [marks, setMarks] = useState<Record<string, string>>(initial ?? {});
  const [pending, start] = useTransition();
  const mark = (itemId: string, result: "GOT" | "MISSED") => {
    setMarks((m) => ({ ...m, [itemId]: result }));
    if (canRecord) start(async () => void (await recordCheckpointAction(blockId, itemId, result)));
  };
  const got = Object.values(marks).filter((m) => m === "GOT").length;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{data.title}</p>
        {Object.keys(marks).length > 0 && (
          <p className="text-xs text-muted">
            You got {got} of {data.items.length}
          </p>
        )}
      </div>
      {data.instructions && <p className="text-sm text-muted">{data.instructions}</p>}
      <ol className="flex flex-col gap-3">
        {data.items.map((it, n) => (
          <li key={it.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex gap-2 text-sm">
              <span className="font-semibold tabular-nums">{n + 1}.</span>
              <div className="min-w-0 flex-1">
                <Markdown>{it.prompt}</Markdown>
              </div>
            </div>
            {shown[it.id] ? (
              <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3 text-sm">
                <p>
                  <span className="font-semibold">Answer:</span> {it.answer}
                </p>
                {it.explanation && <Markdown>{it.explanation}</Markdown>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={marks[it.id] === "GOT" ? "primary" : "secondary"} aria-pressed={marks[it.id] === "GOT"} disabled={pending} onClick={() => mark(it.id, "GOT")}>
                    I got it
                  </Button>
                  <Button size="sm" variant={marks[it.id] === "MISSED" ? "primary" : "secondary"} aria-pressed={marks[it.id] === "MISSED"} disabled={pending} onClick={() => mark(it.id, "MISSED")}>
                    I missed it
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setShown((s) => ({ ...s, [it.id]: true }))}>
                  Show answer
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** "Try it in Desmos": the expressions loaded into an embedded calculator, the steps beside it, then check and watch-out notes. */
export function DesmosStepsBlock({ data, desmosKey }: { data: DesmosSteps; desmosKey: string | null }) {
  const g = useRef<DesmosHandle>(null);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <p className="font-semibold">Try it in Desmos: {data.title}</p>
        {data.useWhen && <p className="text-sm text-muted">Use it when: {data.useWhen}</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-2">
          <DesmosGraph ref={g} apiKey={desmosKey} variant="check" interactive initialExpressions={data.expressions} label={`Desmos: ${data.title}`} />
          {desmosKey && (
            <div>
              <Button size="sm" variant="secondary" onClick={() => g.current?.setExpressions(data.expressions)}>
                Reset graph
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {data.steps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5">
              {data.steps.map((s, i) => (
                <li key={i}>
                  <Markdown>{s}</Markdown>
                </li>
              ))}
            </ol>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted">What to type</summary>
            <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
              {data.expressions.map((e) => (
                <li key={e.id}>{e.latex}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
      {data.check && (
        <p className="text-xs">
          <span className="font-semibold">Check:</span> {data.check}
        </p>
      )}
      {data.watchOut && (
        <p className="text-xs text-warning">
          <span className="font-semibold">Watch out:</span> {data.watchOut}
        </p>
      )}
    </Card>
  );
}
