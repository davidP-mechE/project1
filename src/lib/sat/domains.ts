/**
 * The digital SAT's sections, content domains and skills (names only, from the
 * public test outline; no test content). Used to tag questions and assignments,
 * to roll up reports, and to scope specialists.
 */

export type SectionId = "MATH" | "RW";

export type Domain = { id: string; section: SectionId; name: string; skills: string[] };

export const SECTIONS: { id: SectionId; name: string; short: string }[] = [
  { id: "MATH", name: "Math", short: "Math" },
  { id: "RW", name: "Reading and Writing", short: "R&W" },
];

export const DOMAINS: Domain[] = [
  {
    id: "algebra",
    section: "MATH",
    name: "Algebra",
    skills: [
      "Linear equations in one variable",
      "Linear functions",
      "Linear equations in two variables",
      "Systems of two linear equations in two variables",
      "Linear inequalities in one or two variables",
    ],
  },
  {
    id: "advanced-math",
    section: "MATH",
    name: "Advanced Math",
    skills: ["Equivalent expressions", "Nonlinear equations in one variable and systems of equations in two variables", "Nonlinear functions"],
  },
  {
    id: "psda",
    section: "MATH",
    name: "Problem-Solving and Data Analysis",
    skills: [
      "Ratios, rates, proportional relationships, and units",
      "Percentages",
      "One-variable data: distributions and measures of center and spread",
      "Two-variable data: models and scatterplots",
      "Probability and conditional probability",
      "Inference from sample statistics and margin of error",
      "Evaluating statistical claims: observational studies and experiments",
    ],
  },
  {
    id: "geo-trig",
    section: "MATH",
    name: "Geometry and Trigonometry",
    skills: ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"],
  },
  {
    id: "info-ideas",
    section: "RW",
    name: "Information and Ideas",
    skills: ["Central ideas and details", "Command of evidence: textual", "Command of evidence: quantitative", "Inferences"],
  },
  {
    id: "craft-structure",
    section: "RW",
    name: "Craft and Structure",
    skills: ["Words in context", "Text structure and purpose", "Cross-text connections"],
  },
  {
    id: "expression",
    section: "RW",
    name: "Expression of Ideas",
    skills: ["Rhetorical synthesis", "Transitions"],
  },
  {
    id: "conventions",
    section: "RW",
    name: "Standard English Conventions",
    skills: ["Boundaries", "Form, structure, and sense"],
  },
];

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

const byId = new Map(DOMAINS.map((d) => [d.id, d]));
export const domainById = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
export const domainName = (id: string | null | undefined) => domainById(id)?.name ?? "Untagged";
export const sectionName = (id: string | null | undefined) => SECTIONS.find((s) => s.id === id)?.name ?? "Untagged";
export const isSection = (s: unknown): s is SectionId => s === "MATH" || s === "RW";
export const isDomain = (d: unknown): d is string => typeof d === "string" && byId.has(d);
export const domainsOf = (section: SectionId) => DOMAINS.filter((d) => d.section === section).map((d) => d.id);

/** Clean up tags from Claude or a form: unknown values are dropped, and the section follows the domain. */
export function cleanTags(t: { section?: unknown; domain?: unknown; skill?: unknown; difficulty?: unknown }) {
  const domain = isDomain(t.domain) ? t.domain : null;
  const section = domain ? byId.get(domain)!.section : isSection(t.section) ? t.section : null;
  const skill = domain && typeof t.skill === "string" ? (byId.get(domain)!.skills.find((s) => s.toLowerCase() === t.skill!.toString().trim().toLowerCase()) ?? null) : null;
  const difficulty = (DIFFICULTIES as readonly string[]).includes(String(t.difficulty)) ? (t.difficulty as Difficulty) : null;
  return { section, domain, skill, difficulty };
}

/**
 * The domains a staff scope allows: every domain in its sections, plus the
 * domains named directly. Null means no subject limit.
 */
export function allowedDomains(scope: { sections: string[]; domains: string[] }): Set<string> | null {
  if (scope.sections.length === 0 && scope.domains.length === 0) return null;
  const out = new Set<string>(scope.domains.filter(isDomain));
  for (const s of scope.sections) if (isSection(s)) for (const d of domainsOf(s)) out.add(d);
  return out;
}

/**
 * The domains a piece of work covers: its own domains, or every domain of its
 * section. Empty means untagged.
 */
export function workDomains(work: { section: string | null; domains: string[] }): string[] {
  if (work.domains.length) return work.domains;
  return isSection(work.section) ? domainsOf(work.section) : [];
}

/** Whether a subject scope covers a piece of work. Untagged work is only visible without a subject limit. */
export function scopeCovers(allowed: Set<string> | null, work: { section: string | null; domains: string[] }) {
  if (!allowed) return true;
  const d = workDomains(work);
  return d.length > 0 && d.every((x) => allowed.has(x));
}

/** Describe a scope for people: "Math", "Advanced Math, Algebra", "Math · group Tuesday". */
export function scopeLabel(scope: { sections: string[]; domains: string[] }) {
  const parts = [...scope.sections.map((s) => sectionName(s)), ...scope.domains.map((d) => domainName(d))];
  return parts.length ? parts.join(", ") : "All subjects";
}
