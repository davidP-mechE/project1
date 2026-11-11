/**
 * The product. Programs that run on Coursebook (such as a school's SAT
 * program) keep their own name, badge and public page as data on their
 * Program record, never here.
 */
export const BRAND = {
  name: "Coursebook",
  tagline: "Turn textbooks and slides into courses, and run tutoring programs on top.",
} as const;

/** A program's badge text: its own, a number in its name ("1600"), or its initials. */
export function badgeText(program: { name: string; badge?: string | null }) {
  const own = program.badge?.trim();
  if (own) return own.slice(0, 4).toUpperCase();
  const num = /\b\d{3,4}\b/.exec(program.name)?.[0];
  if (num) return num;
  const words = program.name.replace(/^the\s+/i, "").split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
  return (words.slice(0, 3).map((w) => w[0]).join("") || "P").toUpperCase();
}
