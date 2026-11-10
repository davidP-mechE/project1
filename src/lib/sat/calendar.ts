/**
 * Mapping curriculum units onto the school calendar: each unit takes whole
 * weeks (Monday to Friday), in order, from the start date. Units start and end
 * on school days: never on a weekend or a closed day (holidays, breaks).
 */

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const key = (d: Date) => d.toISOString().slice(0, 10);

/** The Monday of the week a date falls in (Sunday counts as the end of the week). */
export function mondayOf(d: Date) {
  const t = utcDay(d);
  const dow = t.getUTCDay() || 7;
  return new Date(t.getTime() - (dow - 1) * DAY);
}

export function isSchoolDay(d: Date, closed: Set<string>) {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !closed.has(key(d));
}

/** A whole week with no school days (e.g. winter break) is skipped. */
function weekHasSchool(monday: Date, closed: Set<string>) {
  for (let i = 0; i < 5; i++) if (isSchoolDay(new Date(monday.getTime() + i * DAY), closed)) return true;
  return false;
}

export function scheduleUnits<T extends { weeks: number }>(units: T[], start: Date, closedDates: Date[] = []): (T & { startsOn: Date; endsOn: Date })[] {
  const closed = new Set(closedDates.map((d) => key(utcDay(d))));
  let monday = mondayOf(start);
  // If the start is after Friday's school day, begin next week.
  const out: (T & { startsOn: Date; endsOn: Date })[] = [];
  let first = true;
  for (const u of units) {
    const weeks: Date[] = [];
    while (weeks.length < Math.max(1, Math.round(u.weeks))) {
      if (weekHasSchool(monday, closed)) weeks.push(monday);
      monday = new Date(monday.getTime() + 7 * DAY);
    }
    let s = weeks[0];
    if (first) {
      // The first unit starts on the start date itself if that's a school day in its first week.
      const sd = utcDay(start);
      if (sd >= weeks[0] && sd.getTime() < weeks[0].getTime() + 5 * DAY) s = sd;
      first = false;
    }
    while (!isSchoolDay(s, closed)) s = new Date(s.getTime() + DAY);
    let e = new Date(weeks.at(-1)!.getTime() + 4 * DAY);
    while (!isSchoolDay(e, closed) && e > s) e = new Date(e.getTime() - DAY);
    out.push({ ...u, startsOn: s, endsOn: e });
  }
  return out;
}

/** Push every unit from `fromOrder` on later by whole school weeks (used when a review week is added). */
export function shiftUnits<T extends { order: number; startsOn: Date; endsOn: Date }>(units: T[], fromOrder: number, weeks: number, closedDates: Date[] = []) {
  const sorted = [...units].sort((a, b) => a.order - b.order);
  const keep = sorted.filter((u) => u.order < fromOrder);
  const moved = sorted.filter((u) => u.order >= fromOrder);
  if (!moved.length) return sorted;
  const lengths = moved.map((u) => ({ u, weeks: Math.max(1, Math.round((mondayOf(u.endsOn).getTime() - mondayOf(u.startsOn).getTime()) / (7 * DAY)) + 1) }));
  const start = new Date(mondayOf(moved[0].startsOn).getTime() + weeks * 7 * DAY);
  const placed = scheduleUnits(lengths, start, closedDates);
  return [...keep, ...placed.map((p) => ({ ...p.u, startsOn: p.startsOn, endsOn: p.endsOn }))];
}

/** The 1600 Project's default SAT plan (used without any AI call). */
export const SAT_TEMPLATE: { title: string; domains: string[]; weeks: number; notes: string }[] = [
  { title: "Diagnostic and orientation", domains: [], weeks: 1, notes: "Take the diagnostic; set goals and test dates; Bluebook and Desmos set-up." },
  { title: "Algebra", domains: ["algebra"], weeks: 2, notes: "Linear equations, functions, systems and inequalities." },
  { title: "Information and Ideas", domains: ["info-ideas"], weeks: 1, notes: "Central ideas, evidence (text and data), inferences." },
  { title: "Advanced Math", domains: ["advanced-math"], weeks: 2, notes: "Equivalent expressions, nonlinear equations and functions." },
  { title: "Craft and Structure", domains: ["craft-structure"], weeks: 1, notes: "Words in context, structure and purpose, cross-text connections." },
  { title: "Problem-Solving and Data Analysis", domains: ["psda"], weeks: 2, notes: "Ratios, percentages, statistics, probability." },
  { title: "Expression of Ideas", domains: ["expression"], weeks: 1, notes: "Rhetorical synthesis and transitions." },
  { title: "Geometry and Trigonometry", domains: ["geo-trig"], weeks: 1, notes: "Area and volume, angles and triangles, right-triangle trig, circles." },
  { title: "Standard English Conventions", domains: ["conventions"], weeks: 2, notes: "Boundaries; form, structure and sense." },
  { title: "Full practice test and review", domains: [], weeks: 1, notes: "Bluebook practice test; enter the score and misses." },
  { title: "Mixed review: weakest domains", domains: [], weeks: 2, notes: "Work from each student's mistake log and weakest domains." },
  { title: "Final review", domains: [], weeks: 1, notes: "Timing, strategy, rest before test day." },
];
