/**
 * Subjects for the Mastery page. Each course gets one, detected from its title
 * and outline (free, no AI call); the student can change it. The list follows
 * how school and college courses are usually grouped, and covers the OpenStax
 * catalog.
 */

export const SUBJECTS = [
  { id: "math", name: "Mathematics", icon: "∑" },
  { id: "physics", name: "Physics", icon: "⚛" },
  { id: "chemistry", name: "Chemistry", icon: "⚗" },
  { id: "biology", name: "Biology", icon: "❦" },
  { id: "earth-space", name: "Earth & space", icon: "☾" },
  { id: "health", name: "Health & nursing", icon: "✚" },
  { id: "computer-science", name: "Computer science", icon: "⌘" },
  { id: "ela", name: "English & writing", icon: "✎" },
  { id: "social-studies", name: "History & social studies", icon: "⚑" },
  { id: "economics", name: "Economics & business", icon: "$" },
  { id: "other", name: "Other", icon: "✦" },
] as const;

export type SubjectId = (typeof SUBJECTS)[number]["id"];
export const SUBJECT_IDS = SUBJECTS.map((s) => s.id) as SubjectId[];
export const subjectOf = (id: string | null | undefined) => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[SUBJECTS.length - 1];
export const isSubjectId = (id: unknown): id is SubjectId => typeof id === "string" && (SUBJECT_IDS as string[]).includes(id);

/** Words that point to a subject. A match in the title counts far more than one in the outline. */
const KEYWORDS: Record<Exclude<SubjectId, "other">, string[]> = {
  math: ["algebra", "calculus", "precalculus", "trigonometry", "geometry", "statistics", "probability", "mathematics", "math", "linear algebra", "differential equation", "equation", "polynomial", "derivative", "integral", "theorem", "matrix", "matrices", "function", "logarithm", "vector"],
  physics: ["physics", "mechanics", "kinematics", "thermodynamics", "electricity", "magnetism", "circuit", "optics", "quantum", "relativity", "newton", "momentum", "velocity", "acceleration", "ohm", "voltage", "current", "energy", "force", "wave"],
  chemistry: ["chemistry", "chemical", "molecule", "molecular", "atom", "atomic", "stoichiometry", "reaction", "acid", "base", "organic", "periodic table", "bond", "solution", "equilibrium", "electron", "oxidation", "mole"],
  biology: ["biology", "cell", "genetics", "evolution", "ecology", "microbiology", "anatomy", "physiology", "organism", "protein", "dna", "rna", "enzyme", "species", "photosynthesis", "tissue", "immune"],
  "earth-space": ["astronomy", "geology", "earth science", "planet", "star", "galaxy", "solar system", "climate", "weather", "atmosphere", "ocean", "plate tectonics", "universe", "telescope"],
  health: ["nursing", "health", "medical", "pharmacology", "nutrition", "patient", "clinical", "disease", "medicine", "dosage", "care"],
  "computer-science": ["computer science", "programming", "python", "java", "javascript", "algorithm", "data structure", "software", "code", "database", "computing", "network", "variable", "loop"],
  ela: ["english", "writing", "literature", "grammar", "rhetoric", "composition", "essay", "poetry", "novel", "reading", "language arts", "ela", "argument", "paragraph", "author", "narrative"],
  "social-studies": ["history", "government", "politics", "political", "sociology", "psychology", "philosophy", "anthropology", "geography", "civics", "war", "revolution", "constitution", "society", "culture", "empire"],
  economics: ["economics", "microeconomics", "macroeconomics", "business", "management", "marketing", "accounting", "finance", "entrepreneurship", "market", "supply", "demand", "inflation", "gdp", "profit"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (text: string, word: string) => (text.match(new RegExp(`\\b${escape(word)}s?\\b`, "gi")) ?? []).length;

/** Scores every subject; the best one wins if it clearly has evidence, otherwise "other". */
export function classifySubject(title: string, outline: string): { subject: SubjectId; scores: Record<string, number> } {
  const scores: Record<string, number> = {};
  for (const [subject, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const w of words) score += count(title, w) * 10 + Math.min(5, count(outline, w));
    scores[subject] = score;
  }
  const [best, second] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!best || best[1] < 6 || (second && best[1] === second[1])) return { subject: "other", scores };
  return { subject: best[0] as SubjectId, scores };
}
