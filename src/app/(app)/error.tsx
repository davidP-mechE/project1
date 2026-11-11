"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Inside the app, an error keeps the sidebar: only the page area shows this.
 * The error itself is reported by the server's error handler (no details here,
 * and nothing the person typed).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: error.message.slice(0, 300), path: location.pathname }) }).catch(() => {});
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="font-display text-2xl font-semibold">This page didn&apos;t load</h1>
      <p className="text-sm text-muted">Sorry, something went wrong on our side. Your work is saved. Try again, or go back to Today.{error.digest && ` (Error code ${error.digest}.)`}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className="inline-flex items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-surface-2">
          Go to Today
        </Link>
      </div>
    </div>
  );
}
