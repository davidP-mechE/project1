/**
 * Dates shown on the site are in the viewer's own timezone (Settings →
 * Studying → Time zone), never the server's. Server pages get the zone from
 * `viewerZone()` and pass it here; client components get it as a prop.
 *
 * Calendar dates with no time (a test date, the day a score was taken) are
 * stored as midnight UTC and must be shown with `dateOnly`, which is the
 * same day for everyone.
 */
export type DateStyle = "day" | "short" | "medium" | "long" | "time" | "dayTime" | "full" | "weekday";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  day: { month: "short", day: "numeric" },
  short: { weekday: "short", month: "short", day: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  long: { dateStyle: "long" },
  time: { hour: "numeric", minute: "2-digit" },
  dayTime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  full: { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  weekday: { weekday: "long", month: "short", day: "numeric" },
};

/** A valid IANA zone, or UTC when the stored value is unknown to this runtime. */
export function safeZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

/** Format an instant in the given zone. */
export function formatInZone(d: Date | string | number, zone: string | null | undefined, style: DateStyle = "medium"): string {
  return new Date(d).toLocaleString("en-US", { ...OPTIONS[style], timeZone: safeZone(zone) });
}

/** Format a calendar date stored as midnight UTC (the same day in every zone). */
export function dateOnly(d: Date | string, style: Exclude<DateStyle, "time" | "dayTime" | "full"> = "medium"): string {
  return new Date(d).toLocaleString("en-US", { ...OPTIONS[style], timeZone: "UTC" });
}

/** The YYYY-MM-DD day an instant falls on in a zone. */
export function dayKey(d: Date, zone: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(zone), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "3 minutes ago", "yesterday", or a date: for message and notification lists. */
export function relativeTime(d: Date | string, zone: string | null | undefined, now = new Date()): string {
  const t = new Date(d);
  const s = Math.round((now.getTime() - t.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (dayKey(t, zone) === dayKey(now, zone)) return formatInZone(t, zone, "time");
  if (s < 6 * 86_400) return new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: safeZone(zone) });
  return formatInZone(t, zone, "medium");
}
