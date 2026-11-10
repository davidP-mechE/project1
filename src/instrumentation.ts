import type { Instrumentation } from "next";

/** Server errors go to our own error log (src/server/monitoring.ts), which emails the site admins. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordError } = await import("./server/monitoring");
    const message = err instanceof Error ? err.message : String(err);
    const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : null;
    await recordError({ kind: context.routeType === "action" ? "action" : "server", message, path: request.path, digest });
  } catch {
    // Never let error reporting break the request.
  }
};
