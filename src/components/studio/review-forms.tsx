"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { reshuffleSetAction, setVideoStatusesAction } from "@/server/actions/studio";
import { thumbnailUrl, videoRef, type VideoData } from "@/lib/studio/blocks";
import { VideoStatusToggle } from "./studio-forms";

/** One video on the review page: thumbnail, title, where it's used, a link to watch, and its status. */
export function VideoReviewRow({ blockId, video, where, lessonHref }: { blockId: string; video: VideoData; where: string; lessonHref: string }) {
  const ref = videoRef(video);
  const thumb = ref ? thumbnailUrl(ref) : null;
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" loading="lazy" className="h-16 w-28 shrink-0 rounded border border-border object-cover" />
      ) : (
        <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-xs text-muted">Playlist</span>
      )}
      <div className="min-w-0 flex-1">
        <a href={video.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
          {video.title}
          <span className="sr-only"> (opens YouTube in a new tab)</span>
        </a>
        {video.whyWatch && <p className="text-sm text-muted">{video.whyWatch}</p>}
        <p className="text-xs text-muted">
          <Link href={lessonHref} className="hover:underline">{where}</Link>
        </p>
      </div>
      <VideoStatusToggle blockId={blockId} status={video.reviewStatus} />
    </li>
  );
}

export function BulkVideoStatus({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Approve all ${ids.length} unreviewed videos? Students will see them.`)) return;
          start(async () => {
            const r = await setVideoStatusesAction(ids, "approved");
            setMsg(r.ok ? `Approved ${r.changed}.` : r.error);
            router.refresh();
          });
        }}
      >
        Approve all {ids.length} unreviewed
      </Button>
      <span role="status" className="text-sm text-muted">{msg}</span>
    </div>
  );
}

export function ReshuffleButton({ setId }: { setId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reshuffleSetAction(setId);
            setMsg(r.ok ? "Reshuffled." : r.error);
            router.refresh();
          })
        }
      >
        Reshuffle
      </Button>
      <span role="status" className="text-xs text-muted">{msg}</span>
    </span>
  );
}
