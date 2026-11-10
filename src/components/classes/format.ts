/** Shared formatting for class pages. */
export const dueText = (d: Date | string | null, now = new Date()) => {
  if (!d) return "No due date";
  const due = new Date(d);
  const day = due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${due < now ? "Was due" : "Due"} ${day}, ${time}`;
};
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
export const STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", done: "Done", not_assigned: "Not assigned" } as const;
