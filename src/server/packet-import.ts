import "server-only";
import { db } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { qbankExternalId } from "@/lib/bank/qbank";
import { packetSets, parsePacket, type BlockSpec, type PacketSet } from "@/lib/studio/packet";

/**
 * Importing a course packet into the Course Studio (npm run import:courses).
 * The course comes in as a draft only the owner sees. Its practice sets are
 * built from the bank (import the Question Bank first) and keep the packet's
 * visibility (in_house) and order. Safe to run again: units, lessons, blocks
 * and sets are matched by the packet's ids. On a re-import, videos keep their
 * review status and any link or title you changed, blocks you added in the
 * Studio stay, and a course you've published stays published.
 */

export type PacketReport = {
  slug: string;
  title: string;
  course: "created" | "updated" | "dry run";
  units: number;
  lessons: number;
  blocksByType: Record<string, number>;
  sets: number;
  questionIds: { referenced: number; found: number; missing: string[] };
  warnings: string[];
};

async function upsertSet(s: PacketSet, byCbId: Map<string, { id: string; skillId: string | null; source: string }>, ownerId: string | null, tx: Prisma.TransactionClient) {
  const qs = s.question_ids.flatMap((qid) => (byCbId.has(qid) ? [byCbId.get(qid)!] : []));
  const ids = qs.map((q) => q.id);
  const existing = await tx.questionSet.findUnique({ where: { key: s.set_id }, select: { id: true, questionIds: true } });
  // A set you reshuffled keeps your order while it holds the same questions.
  const sameQuestions = existing && existing.questionIds.length === ids.length && ids.every((id) => existing.questionIds.includes(id));
  const data = {
    title: s.title.slice(0, 200),
    description: s.note?.slice(0, 2000) || null,
    questionIds: sameQuestions ? existing!.questionIds : ids,
    skillIds: [...new Set(qs.flatMap((q) => (q.skillId ? [q.skillId] : [])))],
    audience: s.visibility === "in_house" ? ("in_house" as const) : ("public" as const),
    source: qs.some((q) => q.source === "college_board") || s.source === "college_board" ? ("college_board" as const) : ("original" as const),
    status: s.status === "ready" ? ("published" as const) : ("draft" as const),
    visibility: "class" as const,
  };
  if (existing) return (await tx.questionSet.update({ where: { id: existing.id }, data, select: { id: true } })).id;
  return (await tx.questionSet.create({ data: { ...data, key: s.set_id, authorId: ownerId }, select: { id: true } })).id;
}

export async function importCoursePacket(opts: { json: string; commit: boolean; ownerId: string | null }): Promise<PacketReport> {
  let raw: unknown;
  try {
    raw = JSON.parse(opts.json);
  } catch {
    throw new Error("The course file isn't valid JSON.");
  }
  const p = parsePacket(raw);
  if (!p.course) throw new Error(p.errors.join(" "));
  const c = p.course;
  const sets = packetSets(c);
  const referenced = [...new Set(sets.flatMap((s) => s.question_ids))];
  const bank = await db.bankQuestion.findMany({ where: { externalId: { in: referenced.map(qbankExternalId) } }, select: { id: true, externalId: true, skillId: true, source: true } });
  const byCbId = new Map(bank.map((q) => [q.externalId!.replace(/^CB-/, ""), q]));
  const missing = referenced.filter((id) => !byCbId.has(id));
  const blocksByType: Record<string, number> = {};
  for (const u of c.units) for (const l of u.lessons) for (const b of l.blocks) blocksByType[b.kind] = (blocksByType[b.kind] ?? 0) + 1;
  const report: PacketReport = {
    slug: c.slug,
    title: c.title,
    course: "dry run",
    units: c.units.length,
    lessons: c.units.reduce((n, u) => n + u.lessons.length, 0),
    blocksByType,
    sets: sets.length,
    questionIds: { referenced: referenced.length, found: referenced.length - missing.length, missing },
    warnings: p.warnings,
  };
  if (!opts.commit) return report;

  await db.$transaction(
    async (tx) => {
      const setIds = new Map<string, string>();
      for (const s of sets) setIds.set(s.set_id, await upsertSet(s, byCbId, opts.ownerId, tx));

      const existing = await tx.studioCourse.findUnique({ where: { slug: c.slug }, select: { id: true } });
      report.course = existing ? "updated" : "created";
      const meta = { title: c.title, section: c.section, description: c.description, program: c.program, estimatedHours: c.estimatedHours };
      const course = existing
        ? await tx.studioCourse.update({ where: { id: existing.id }, data: meta })
        : await tx.studioCourse.create({ data: { ...meta, slug: c.slug, status: "draft", visibility: "owner_only", ownerId: opts.ownerId } });

      const oldUnits = await tx.studioUnit.findMany({ where: { courseId: course.id }, select: { id: true, key: true } });
      for (const [ui, u] of c.units.entries()) {
        const hit = oldUnits.find((x) => x.key === u.key);
        const unit = hit
          ? await tx.studioUnit.update({ where: { id: hit.id }, data: { title: u.title, summary: u.summary, order: ui } })
          : await tx.studioUnit.create({ data: { courseId: course.id, key: u.key, title: u.title, summary: u.summary, order: ui } });
        const oldLessons = await tx.studioLesson.findMany({ where: { unitId: unit.id }, select: { id: true, key: true } });
        for (const [li, l] of u.lessons.entries()) {
          const lmeta = { title: l.title, number: l.number, estimatedMinutes: l.estimatedMinutes, objectives: l.objectives, skills: l.skills, blueprints: l.blueprints, order: li };
          const lh = oldLessons.find((x) => x.key === l.key);
          const lesson = lh ? await tx.studioLesson.update({ where: { id: lh.id }, data: lmeta }) : await tx.studioLesson.create({ data: { ...lmeta, unitId: unit.id, key: l.key } });
          await syncBlocks(tx, lesson.id, l.blocks, setIds);
        }
      }
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  return report;
}

/** Put a lesson's packet blocks in order. Videos already there keep their data (review status, your edits). */
async function syncBlocks(tx: Prisma.TransactionClient, lessonId: string, specs: BlockSpec[], setIds: Map<string, string>) {
  const old = await tx.studioBlock.findMany({ where: { lessonId }, orderBy: { order: "asc" } });
  const byKey = new Map(old.filter((b) => b.key).map((b) => [b.key!, b]));
  const keep = new Set<string>();
  for (const [i, spec] of specs.entries()) {
    const data = (spec.kind === "question_set" ? { setId: setIds.get(spec.set.set_id) } : spec.data) as Prisma.InputJsonValue;
    const hit = byKey.get(spec.key);
    if (hit && hit.kind === spec.kind) {
      keep.add(hit.id);
      await tx.studioBlock.update({ where: { id: hit.id }, data: { order: i, ...(spec.kind === "video" ? {} : { data }) } });
    } else {
      const b = await tx.studioBlock.create({ data: { lessonId, kind: spec.kind, key: spec.key, data, order: i } });
      keep.add(b.id);
    }
  }
  // Packet blocks no longer in the packet go; blocks you added in the Studio (no key) stay, after the packet's.
  await tx.studioBlock.deleteMany({ where: { lessonId, key: { not: null }, id: { notIn: [...keep] } } });
  const extra = old.filter((b) => !b.key);
  for (const [j, b] of extra.entries()) await tx.studioBlock.update({ where: { id: b.id }, data: { order: specs.length + j } });
}
