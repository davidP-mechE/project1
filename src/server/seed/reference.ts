import "server-only";
import { db } from "../db";
import { DOMAINS } from "@/lib/sat/domains";

/**
 * Reference data for the SAT practice tracker, question bank and Course Studio.
 *
 * CONTENT RULE: nothing here is College Board content. Skills are the public
 * names of the test's domains and skills; practice tests are a name and module
 * sizes only (no questions, passages, explanations or answer keys).
 */

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const SECTION = { MATH: "math", RW: "rw" } as const;

/** Domains (parent rows) and their skills, with stable ids like "math.algebra.linear-equations-in-one-variable". */
export function skillRows() {
  const rows: { id: string; section: "math" | "rw"; domain: string; name: string; parentId: string | null; order: number }[] = [];
  DOMAINS.forEach((d, di) => {
    const section = SECTION[d.section];
    const domainId = `${section}.${d.id}`;
    rows.push({ id: domainId, section, domain: d.name, name: d.name, parentId: null, order: di * 100 });
    d.skills.forEach((s, si) => rows.push({ id: `${domainId}.${slug(s)}`, section, domain: d.name, name: s, parentId: domainId, order: di * 100 + si + 1 }));
  });
  return rows;
}

export const ERROR_TYPES = [
  { id: "careless", label: "Careless" },
  { id: "concept-gap", label: "Concept gap" },
  { id: "misread", label: "Misread question" },
  { id: "time", label: "Ran out of time" },
  { id: "guessed", label: "Guessed" },
  { id: "calculator", label: "Calculator/Desmos misuse" },
];

/** The digital SAT's module layout: two Reading and Writing modules of 27, two Math modules of 22. */
export const STANDARD_MODULES = [
  { section: "rw", number: 1, question_count: 27 },
  { section: "rw", number: 2, question_count: 27 },
  { section: "math", number: 1, question_count: 22 },
  { section: "math", number: 2, question_count: 22 },
];

export const SEED_TESTS = [
  { id: "seed-bluebook-practice-4", name: "Bluebook Practice Test 4", source: "bluebook" as const },
  { id: "seed-bluebook-practice-5", name: "Bluebook Practice Test 5", source: "bluebook" as const },
  { id: "seed-bluebook-practice-6", name: "Bluebook Practice Test 6", source: "bluebook" as const },
];

export const SEED_COURSES = [
  { slug: "desmos-masterclass", title: "Desmos Masterclass", section: "math" as const },
  { slug: "advanced-ebrw", title: "Advanced EBRW", section: "ebrw" as const },
];

/**
 * Insert any reference rows that are missing (ids are fixed, so re-running is safe).
 * `onlyIfEmpty`: at server start, a table is filled only when it's empty, so the
 * owner's later edits and deletions are never undone.
 */
export async function ensureReferenceData({ onlyIfEmpty = true } = {}) {
  const out = { skills: 0, errorTypes: 0, tests: 0, courses: 0 };
  if (!onlyIfEmpty || (await db.skill.count()) === 0) {
    const rows = skillRows();
    // Parents first (the tree has a foreign key).
    out.skills += (await db.skill.createMany({ data: rows.filter((r) => !r.parentId), skipDuplicates: true })).count;
    out.skills += (await db.skill.createMany({ data: rows.filter((r) => r.parentId), skipDuplicates: true })).count;
  }
  if (!onlyIfEmpty || (await db.errorType.count()) === 0) {
    out.errorTypes = (await db.errorType.createMany({ data: ERROR_TYPES.map((e, i) => ({ ...e, order: i })), skipDuplicates: true })).count;
  }
  if (!onlyIfEmpty || (await db.practiceTest.count({ where: { createdById: null } })) === 0) {
    out.tests = (await db.practiceTest.createMany({ data: SEED_TESTS.map((t) => ({ ...t, modules: STANDARD_MODULES, shared: true })), skipDuplicates: true })).count;
  }
  if (!onlyIfEmpty || (await db.studioCourse.count()) === 0) {
    const owner = process.env.OWNER_EMAIL?.trim();
    const ownerRow = owner ? await db.user.findFirst({ where: { email: { equals: owner, mode: "insensitive" }, emailVerified: true }, select: { id: true } }) : null;
    for (const c of SEED_COURSES) {
      if (await db.studioCourse.findUnique({ where: { slug: c.slug }, select: { id: true } })) continue;
      await db.studioCourse.create({
        data: { ...c, description: "", status: "draft", visibility: "owner_only", ownerId: ownerRow?.id ?? null, units: { create: { order: 0, title: "Unit 1 (placeholder)" } } },
      });
      out.courses += 1;
    }
  }
  return out;
}
