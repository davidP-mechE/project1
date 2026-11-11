import type { Instrumentation } from "next";

/**
 * At server start: give the OWNER_EMAIL account the owner role (and take it
 * from anyone else), and create the reference data (skills, error types,
 * practice-test catalog, the two draft studio courses) if those tables are empty.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureReferenceData } = await import("./server/seed/reference");
    const { syncOwnerRole } = await import("./server/roles");
    await ensureReferenceData();
    await syncOwnerRole();
  } catch (err) {
    console.error("Startup role/seed check failed:", err instanceof Error ? err.message : err);
  }
}


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
