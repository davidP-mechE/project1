import { validTimeZone } from "@/lib/srs/queue";

/**
 * Calendar days in the student's time zone, as "YYYY-MM-DD" strings.
 * Plain strings compare and sort correctly and never shift with time zones.
 */
export type Day = string;

export function localDay(at: Date, timeZone: string): Day {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: validTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(timeZone), hour: "2-digit", hourCycle: "h23" }).format(at));
}

const toUtc = (d: Day) => {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
};
const fromUtc = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

export function addDays(d: Day, n: number): Day {
  return fromUtc(toUtc(d) + n * 86_400_000);
}
export function daysBetween(a: Day, b: Day): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: Day): number {
  return new Date(toUtc(d)).getUTCDay();
}
export function isDay(s: unknown): s is Day {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}
export function formatDay(d: Day, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Date(toUtc(d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
