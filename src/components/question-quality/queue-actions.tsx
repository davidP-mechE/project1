"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { resolveReportsAction, unpublishReportedAction } from "@/server/actions/question-quality";

/** Actions on one reported question: resolve as fixed or no change, edit it, or unpublish it. */
export function QueueActions({ reportKey, editHref, canUnpublish }: { reportKey: string; editHref: string; canUnpublish: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); setError(r.ok ? null : (r.error ?? "Something went wrong.")); router.refresh(); });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        <ButtonLink href={editHref} size="sm" variant="secondary">Edit the question</ButtonLink>
        <Button size="sm" disabled={pending} onClick={() => act(() => resolveReportsAction(reportKey, "FIXED"))}>Mark fixed</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => resolveReportsAction(reportKey, "NO_CHANGE"))}>No change needed</Button>
        {canUnpublish && <Button size="sm" variant="danger" disabled={pending} onClick={() => act(() => unpublishReportedAction(reportKey))}>Unpublish</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
