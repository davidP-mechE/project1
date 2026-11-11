"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { reportProblemAction } from "@/server/actions/support";

declare global {
  interface Window {
    __cbErrorIds?: string[];
  }
}

/** Sends browser errors (message and page only) to the server's error log, and remembers their ids for a problem report. */
export function ErrorCapture() {
  useEffect(() => {
    const send = (message: string) => {
      fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.slice(0, 1000), path: window.location.pathname }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { id?: string } | null) => {
          if (j?.id) window.__cbErrorIds = [...(window.__cbErrorIds ?? []), j.id].slice(-10);
        })
        .catch(() => {});
    };
    const onError = (e: ErrorEvent) => send(e.message || "Script error");
    const onRejection = (e: PromiseRejectionEvent) => send(e.reason instanceof Error ? e.reason.message : String(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

/** "Report a problem": sends the page, the browser and recent error ids (never what's typed in forms) to the site admins. */
export function ReportProblemButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<null | "ok" | string>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className={className} onClick={() => (setSent(null), dialog.current?.showModal())}>
        Report a problem
      </button>
      <dialog ref={dialog} aria-labelledby="report-title" className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-5 text-text backdrop:bg-black/40">
        <h2 id="report-title" className="text-lg font-semibold">
          Report a problem
        </h2>
        {sent === "ok" ? (
          <>
            <p className="mt-3 text-sm">Thanks, it&apos;s been sent. The site admin will look into it.</p>
            <button type="button" className="mt-3 h-10 rounded-xl px-4 text-sm font-semibold hover:bg-surface-2" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </>
        ) : (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await reportProblemAction({ path: pathname, userAgent: navigator.userAgent, errorIds: window.__cbErrorIds ?? [], note });
                setSent(r.ok ? "ok" : r.error);
                if (r.ok) setNote("");
              });
            }}
          >
            <p className="text-sm text-muted">We&apos;ll send this page&apos;s address, your browser and any recent error codes. Nothing you&apos;ve typed into the page is included.</p>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">What happened? (optional; please don&apos;t include personal details)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="rounded-lg border border-border bg-surface px-3 py-2" />
            </label>
            {sent && sent !== "ok" && <p className="text-sm text-danger">{sent}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-text hover:bg-primary-hover disabled:opacity-60">
                Send report
              </button>
              <button type="button" className="h-10 rounded-xl px-4 text-sm font-semibold hover:bg-surface-2" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
