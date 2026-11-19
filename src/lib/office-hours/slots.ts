/**
 * Office-hours slots, worked out from a staff member's weekly rules. Pure (no
 * database), so the rules are unit-tested: times are local to the rule's time
 * zone (so "Tuesday 3:30pm" stays 3:30pm across daylight-saving changes).
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type Rule = {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  maxPerDay: number;
  validFrom: string;
  validUntil: string | null;
  location: string | null;
};

export type Slot = { ruleId: string; start: Date; end: Date; day: string; location: string | null };

/** Minutes a zone is ahead of UTC at an instant (e.g. -300 for New York in winter). */
export function zoneOffsetMinutes(at: Date, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant of a local day and time in a zone ("2026-11-24", 930 → 3:30pm there). */
export function zonedToUtc(day: string, minutes: number, zone: string) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - zoneOffsetMinutes(new Date(guess), zone) * 60_000;
  t = guess - zoneOffsetMinutes(new Date(t), zone) * 60_000; // again, in case the offset changed in between
  return new Date(t);
}

const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export const fmtMinutes = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;

/**
 * Open slots for rules between two days (inclusive), skipping closed days, the
 * past (and the next `leadMinutes`), taken times, and days already at their
 * maximum. `bookedByDay` counts bookings per local day per rule-owner.
 */
export function openSlots(input: { rules: Rule[]; fromDay: string; toDay: string; closedDays: Set<string>; taken: Set<number>; bookedByDay: Map<string, number>; now: Date; leadMinutes?: number }) {
  const out: Slot[] = [];
  const earliest = input.now.getTime() + (input.leadMinutes ?? 60) * 60_000;
  for (const r of input.rules) {
    if (r.slotMinutes < 5 || r.endMinute <= r.startMinute) continue;
    for (let day = input.fromDay; day <= input.toDay; day = addDay(day, 1)) {
      if (weekdayOf(day) !== r.weekday || day < r.validFrom || (r.validUntil && day > r.validUntil) || input.closedDays.has(day)) continue;
      let left = r.maxPerDay - (input.bookedByDay.get(day) ?? 0);
      if (left <= 0) continue;
      for (let m = r.startMinute; m + r.slotMinutes <= r.endMinute; m += r.slotMinutes + r.bufferMinutes) {
        const start = zonedToUtc(day, m, r.timezone);
        if (start.getTime() < earliest || input.taken.has(start.getTime())) continue;
        out.push({ ruleId: r.id, start, end: new Date(start.getTime() + r.slotMinutes * 60_000), day, location: r.location });
        if (--left <= 0) break;
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
