/** Shared formatting for class pages. */
import { formatInZone } from "@/lib/dates";

/** "Due Mon, Nov 9, 5:00 PM", in the viewer's zone (pass it; UTC otherwise). */
export const dueText = (d: Date | string | null, now = new Date(), zone?: string | null) => {
  if (!d) return "No due date";
  const due = new Date(d);
  const day = formatInZone(due, zone, "short");
  const time = formatInZone(due, zone, "time");
  return `${due < now ? "Was due" : "Due"} ${day}, ${time}`;
};
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
export const STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", done: "Done", not_assigned: "Not assigned" } as const;
