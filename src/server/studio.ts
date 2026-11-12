import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { isOwner } from "./roles";
import { storage } from "./storage";
import { runImport } from "./bank";
import { slug as slugify } from "./seed/reference";
import { Prisma } from "@/generated/prisma/client";
import { DESMOS_TECHNIQUES, techniqueToDb, type DesmosTechniqueName } from "@/lib/bank/import";

/**
 * The owner-only Course Studio.
 *
 * Visibility has ONE rule, in canView() below: the owner sees everything;
 * anyone else sees a course only when it is published AND public. Drafts are
 * "not found" (a plain 404) for everyone else, so nobody can tell they exist.
 * Catalog, search and the JSON list all use PUBLIC_COURSE. Files are served only
 * through /api/studio/files/<id>, which applies the same rule.
 *
 * Sharing a draft with chosen tutors or classes later: StudioCourseShare rows
 * are already in the schema; canView() is the one place to read them.
 */

export class StudioError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const PUBLIC_COURSE = { status: "published", visibility: "public" } as const satisfies Prisma.StudioCourseWhereInput;

type CourseGate = { status: string; visibility: string };
/** The single visibility rule. (Future: also allow rows in StudioCourseShare for this viewer or their classes.) */
export function canView(course: CourseGate, viewer: { isOwner: boolean }) {
  return viewer.isOwner || (course.status === "published" && course.visibility === "public");
}

async function requireOwnerId(userId: string | null) {
  if (!userId || !(await isOwner(userId))) throw new NotFoundError("Not found");
  return userId;
}

// ─── Reading (owner, or students for published courses) ─────────────────

export async function listPublicCourses(q?: string) {
  const term = q?.trim();
  return db.studioCourse.findMany({
    where: { ...PUBLIC_COURSE, ...(term ? { OR: [{ title: { contains: term, mode: "insensitive" } }, { description: { contains: term, mode: "insensitive" } }] } : {}) },
    orderBy: { title: "asc" },
    select: { id: true, slug: true, title: true, section: true, description: true },
  });
}

/** A course by slug, with units and lessons, if this viewer may see it; otherwise "not found". */
export async function courseForViewer(viewerId: string | null, slug: string) {
  const c = await db.studioCourse.findUnique({ where: { slug }, include: { units: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, select: { id: true, title: true } } } } } });
  if (!c || !canView(c, { isOwner: await isOwner(viewerId) })) throw new NotFoundError("Not found");
  return c;
}

export async function lessonForViewer(viewerId: string | null, slug: string, lessonId: string) {
  const course = await courseForViewer(viewerId, slug);
  const lesson = await db.studioLesson.findFirst({ where: { id: lessonId, unit: { courseId: course.id } }, include: { blocks: { orderBy: { order: "asc" } }, files: true, unit: { select: { title: true } } } });
  if (!lesson) throw new NotFoundError("Not found");
  const owner = await isOwner(viewerId);
  // Question-set blocks: students see only published sets with their published questions.
  const setIds = lesson.blocks.flatMap((b) => (b.kind === "question_set" ? [String((b.data as { setId?: string }).setId ?? "")] : []));
  const sets = await db.questionSet.findMany({ where: { id: { in: setIds } }, select: { id: true, title: true, status: true, questionIds: true } });
  const visibleSets = new Map(sets.filter((s) => owner || s.status === "published").map((s) => [s.id, s]));
  const blocks = lesson.blocks.filter((b) => b.kind !== "question_set" || visibleSets.has(String((b.data as { setId?: string }).setId)));
  return { course, lesson: { ...lesson, blocks }, sets: Object.fromEntries(visibleSets), owner };
}

/** A lesson file, if its course is visible to this viewer. */
export async function fileForViewer(viewerId: string | null, fileId: string) {
  const f = await db.studioFile.findUnique({ where: { id: fileId }, include: { lesson: { select: { unit: { select: { course: { select: { status: true, visibility: true } } } } } } } });
  if (!f || !canView(f.lesson.unit.course, { isOwner: await isOwner(viewerId) })) throw new NotFoundError("Not found");
  return f;
}

// ─── Owner: courses, units, lessons ──────────────────────────────────────

export async function studioCourses(ownerId: string) {
  await requireOwnerId(ownerId);
  return db.studioCourse.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { units: { select: { _count: { select: { lessons: true } } } } } });
}

export async function studioCourse(ownerId: string, id: string) {
  await requireOwnerId(ownerId);
  const c = await db.studioCourse.findUnique({ where: { id }, include: { units: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, desmosTechnique: true, _count: { select: { blocks: true } } } } } } } });
  if (!c) throw new NotFoundError("Not found");
  return c;
}

const SECTIONS = ["math", "ebrw", "other"] as const;
type StudioSectionName = (typeof SECTIONS)[number];

async function uniqueSlug(title: string, exceptId?: string) {
  const base = slugify(title).slice(0, 60) || "course";
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await db.studioCourse.findUnique({ where: { slug: s }, select: { id: true } });
    if (!hit || hit.id === exceptId) return s;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/** New courses are always draft + owner_only. */
export async function createCourse(ownerId: string, input: { title: string; section?: string; description?: string }) {
  await requireOwnerId(ownerId);
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new StudioError("Give the course a title.");
  const section = (SECTIONS as readonly string[]).includes(input.section ?? "") ? (input.section as StudioSectionName) : "other";
  return db.studioCourse.create({ data: { title, section, description: input.description?.trim().slice(0, 4000) ?? "", slug: await uniqueSlug(title), ownerId, status: "draft", visibility: "owner_only", units: { create: { order: 0, title: "Unit 1" } } } });
}

export async function updateCourse(ownerId: string, id: string, input: { title?: string; section?: string; description?: string }) {
  await studioCourse(ownerId, id);
  const data: Prisma.StudioCourseUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 160);
    if (!t) throw new StudioError("Give the course a title.");
    data.title = t;
  }
  if (input.section !== undefined && (SECTIONS as readonly string[]).includes(input.section)) data.section = input.section as StudioSectionName;
  if (input.description !== undefined) data.description = input.description.trim().slice(0, 4000);
  return db.studioCourse.update({ where: { id }, data });
}

/** Publishing flips status and visibility together (after the owner confirms in the page). */
export async function publishCourse(ownerId: string, id: string) {
  const c = await studioCourse(ownerId, id);
  if (!c.units.some((u) => u.lessons.length)) throw new StudioError("Add at least one lesson before publishing.");
  return db.studioCourse.update({ where: { id }, data: { status: "published", visibility: "public", publishedAt: new Date() } });
}

/** Unpublish (or un-archive) returns the course to a private draft. */
export async function unpublishCourse(ownerId: string, id: string) {
  await studioCourse(ownerId, id);
  return db.studioCourse.update({ where: { id }, data: { status: "draft", visibility: "owner_only" } });
}

export async function archiveCourse(ownerId: string, id: string) {
  await studioCourse(ownerId, id);
  return db.studioCourse.update({ where: { id }, data: { status: "archived", visibility: "owner_only" } });
}

export async function deleteCourse(ownerId: string, id: string) {
  const c = await studioCourse(ownerId, id);
  if (c.status === "published") throw new StudioError("Unpublish the course before deleting it.");
  const files = await db.studioFile.findMany({ where: { lesson: { unit: { courseId: id } } }, select: { storageKey: true } });
  await db.studioCourse.delete({ where: { id } });
  for (const f of files) await storage.delete(f.storageKey).catch(() => {});
}

export async function addUnit(ownerId: string, courseId: string, title: string) {
  await studioCourse(ownerId, courseId);
  const t = title.trim().slice(0, 160) || "New unit";
  const last = await db.studioUnit.findFirst({ where: { courseId }, orderBy: { order: "desc" }, select: { order: true } });
  return db.studioUnit.create({ data: { courseId, title: t, order: (last?.order ?? -1) + 1 } });
}

async function ownUnit(ownerId: string, unitId: string) {
  await requireOwnerId(ownerId);
  const u = await db.studioUnit.findUnique({ where: { id: unitId } });
  if (!u) throw new NotFoundError("Not found");
  return u;
}

export async function renameUnit(ownerId: string, unitId: string, title: string) {
  await ownUnit(ownerId, unitId);
  const t = title.trim().slice(0, 160);
  if (!t) throw new StudioError("Give the unit a title.");
  return db.studioUnit.update({ where: { id: unitId }, data: { title: t } });
}

export async function deleteUnit(ownerId: string, unitId: string) {
  const u = await ownUnit(ownerId, unitId);
  const files = await db.studioFile.findMany({ where: { lesson: { unitId } }, select: { storageKey: true } });
  await db.studioUnit.delete({ where: { id: u.id } });
  for (const f of files) await storage.delete(f.storageKey).catch(() => {});
}

/** Swap with the neighbour above (-1) or below (+1). */
async function swap<T extends { id: string; order: number }>(rows: T[], id: string, dir: -1 | 1, write: (id: string, order: number) => Promise<unknown>) {
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await write(rows[i].id, rows[j].order);
  await write(rows[j].id, rows[i].order);
}

export async function moveUnit(ownerId: string, unitId: string, dir: -1 | 1) {
  const u = await ownUnit(ownerId, unitId);
  const rows = await db.studioUnit.findMany({ where: { courseId: u.courseId }, orderBy: { order: "asc" }, select: { id: true, order: true } });
  await normalize(rows, (id, order) => db.studioUnit.update({ where: { id }, data: { order } }));
  await swap(rows.map((r, k) => ({ ...r, order: k })), unitId, dir, (id, order) => db.studioUnit.update({ where: { id }, data: { order } }));
}

async function normalize(rows: { id: string; order: number }[], write: (id: string, order: number) => Promise<unknown>) {
  for (let k = 0; k < rows.length; k++) if (rows[k].order !== k) await write(rows[k].id, k);
}

export async function addLesson(ownerId: string, unitId: string, title: string) {
  await ownUnit(ownerId, unitId);
  const t = title.trim().slice(0, 160) || "New lesson";
  const last = await db.studioLesson.findFirst({ where: { unitId }, orderBy: { order: "desc" }, select: { order: true } });
  return db.studioLesson.create({ data: { unitId, title: t, order: (last?.order ?? -1) + 1 } });
}

export async function studioLesson(ownerId: string, lessonId: string) {
  await requireOwnerId(ownerId);
  const l = await db.studioLesson.findUnique({ where: { id: lessonId }, include: { blocks: { orderBy: { order: "asc" } }, files: true, unit: { include: { course: { select: { id: true, title: true, slug: true, section: true, status: true } } } } } });
  if (!l) throw new NotFoundError("Not found");
  return l;
}

export async function updateLesson(ownerId: string, lessonId: string, input: { title?: string; desmosTechnique?: string | null }) {
  await studioLesson(ownerId, lessonId);
  const data: Prisma.StudioLessonUpdateInput = {};
  if (input.title !== undefined) {
    const t = input.title.trim().slice(0, 160);
    if (!t) throw new StudioError("Give the lesson a title.");
    data.title = t;
  }
  if (input.desmosTechnique !== undefined) {
    if (input.desmosTechnique && !(DESMOS_TECHNIQUES as readonly string[]).includes(input.desmosTechnique)) throw new StudioError("Unknown Desmos technique.");
    data.desmosTechnique = input.desmosTechnique ? techniqueToDb(input.desmosTechnique as DesmosTechniqueName) : null;
  }
  return db.studioLesson.update({ where: { id: lessonId }, data });
}

export async function deleteLesson(ownerId: string, lessonId: string) {
  const l = await studioLesson(ownerId, lessonId);
  await db.studioLesson.delete({ where: { id: lessonId } });
  for (const f of l.files) await storage.delete(f.storageKey).catch(() => {});
}

export async function moveLesson(ownerId: string, lessonId: string, dir: -1 | 1) {
  const l = await studioLesson(ownerId, lessonId);
  const rows = await db.studioLesson.findMany({ where: { unitId: l.unitId }, orderBy: { order: "asc" }, select: { id: true, order: true } });
  await normalize(rows, (id, order) => db.studioLesson.update({ where: { id }, data: { order } }));
  await swap(rows.map((r, k) => ({ ...r, order: k })), lessonId, dir, (id, order) => db.studioLesson.update({ where: { id }, data: { order } }));
}

// ─── Owner: content blocks ───────────────────────────────────────────────

async function nextBlockOrder(lessonId: string) {
  const last = await db.studioBlock.findFirst({ where: { lessonId }, orderBy: { order: "desc" }, select: { order: true } });
  return (last?.order ?? -1) + 1;
}

export type BlockInput = { kind: "markdown"; text: string } | { kind: "desmos"; state: object; interactive: boolean; title?: string } | { kind: "question_set"; setId: string };

async function blockData(input: BlockInput): Promise<Prisma.InputJsonValue> {
  if (input.kind === "markdown") {
    if (input.text.length > 100_000) throw new StudioError("That text is too long (100,000 characters at most).");
    return { text: input.text };
  }
  if (input.kind === "desmos") {
    if (!input.state || typeof input.state !== "object") throw new StudioError("Save a graph first.");
    if (JSON.stringify(input.state).length > 200_000) throw new StudioError("That graph is too large.");
    return { state: input.state as Prisma.InputJsonValue, interactive: Boolean(input.interactive), title: input.title?.slice(0, 160) ?? "" };
  }
  const set = await db.questionSet.findUnique({ where: { id: input.setId }, select: { id: true } });
  if (!set) throw new StudioError("Choose a question set.");
  return { setId: set.id };
}

export async function addBlock(ownerId: string, lessonId: string, input: BlockInput) {
  await studioLesson(ownerId, lessonId);
  return db.studioBlock.create({ data: { lessonId, kind: input.kind, data: await blockData(input), order: await nextBlockOrder(lessonId) } });
}

async function ownBlock(ownerId: string, blockId: string) {
  await requireOwnerId(ownerId);
  const b = await db.studioBlock.findUnique({ where: { id: blockId } });
  if (!b) throw new NotFoundError("Not found");
  return b;
}

export async function updateBlock(ownerId: string, blockId: string, input: BlockInput) {
  const b = await ownBlock(ownerId, blockId);
  if (b.kind !== input.kind) throw new StudioError("That block is a different kind.");
  return db.studioBlock.update({ where: { id: blockId }, data: { data: await blockData(input) } });
}

export async function deleteBlock(ownerId: string, blockId: string) {
  const b = await ownBlock(ownerId, blockId);
  await db.studioBlock.delete({ where: { id: blockId } });
  if (b.kind === "file") {
    const fileId = (b.data as { fileId?: string }).fileId;
    const f = fileId ? await db.studioFile.findUnique({ where: { id: fileId } }) : null;
    if (f) {
      await db.studioFile.delete({ where: { id: f.id } });
      await storage.delete(f.storageKey).catch(() => {});
    }
  }
}

export async function moveBlock(ownerId: string, blockId: string, dir: -1 | 1) {
  const b = await ownBlock(ownerId, blockId);
  const rows = await db.studioBlock.findMany({ where: { lessonId: b.lessonId }, orderBy: { order: "asc" }, select: { id: true, order: true } });
  await normalize(rows, (id, order) => db.studioBlock.update({ where: { id }, data: { order } }));
  await swap(rows.map((r, k) => ({ ...r, order: k })), blockId, dir, (id, order) => db.studioBlock.update({ where: { id }, data: { order } }));
}

// ─── Owner: uploads ──────────────────────────────────────────────────────

const MB = 1024 * 1024;
export const UPLOAD_RULES = {
  pdf: { max: 25 * MB, type: "application/pdf", label: "PDF", a: "a" },
  png: { max: 5 * MB, type: "image/png", label: "image", a: "an" },
  jpg: { max: 5 * MB, type: "image/jpeg", label: "image", a: "an" },
  jpeg: { max: 5 * MB, type: "image/jpeg", label: "image", a: "an" },
  gif: { max: 5 * MB, type: "image/gif", label: "image", a: "an" },
  webp: { max: 5 * MB, type: "image/webp", label: "image", a: "an" },
  md: { max: 1 * MB, type: "text/markdown", label: "Markdown file", a: "a" },
  markdown: { max: 1 * MB, type: "text/markdown", label: "Markdown file", a: "a" },
  json: { max: 5 * MB, type: "application/json", label: "question-set JSON file", a: "a" },
} as const;

function magicOk(ext: keyof typeof UPLOAD_RULES, b: Buffer) {
  switch (ext) {
    case "pdf":
      return b.subarray(0, 5).toString("latin1") === "%PDF-";
    case "png":
      return b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case "jpg":
    case "jpeg":
      return b[0] === 0xff && b[1] === 0xd8;
    case "gif":
      return b.subarray(0, 4).toString("latin1") === "GIF8";
    case "webp":
      return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
    default:
      return true;
  }
}

export type UploadResult =
  | { kind: "file"; blockId: string; name: string }
  | { kind: "markdown"; blockId: string; name: string }
  | { kind: "question_set"; blockId: string; setId: string; imported: number; failed: number; skipped: number; problems: { row: number; externalId: string | null; errors: string[] }[] };

/**
 * One upload into a lesson. Checked by extension AND content: PDFs and images
 * become file blocks (served only through the checked route); Markdown becomes
 * a text block; question-set JSON (the bank import format) is imported as draft
 * questions in a new draft set, shown as a question-set block.
 */
export async function uploadToLesson(ownerId: string, lessonId: string, name: string, bytes: Buffer): Promise<UploadResult> {
  const lesson = await studioLesson(ownerId, lessonId);
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "") as keyof typeof UPLOAD_RULES;
  const rule = UPLOAD_RULES[ext];
  if (!rule) throw new StudioError(`"${name}" isn't a type you can upload. Use a PDF, an image (PNG, JPEG, GIF, WebP), Markdown (.md) or question-set JSON (.json).`);
  if (bytes.length === 0) throw new StudioError(`"${name}" is empty.`);
  if (bytes.length > rule.max) throw new StudioError(`"${name}" is too large: ${rule.a} ${rule.label} can be at most ${rule.max / MB} MB.`);
  if (!magicOk(ext, bytes)) throw new StudioError(`"${name}" doesn't look like a real ${rule.label} (its contents don't match its name).`);
  const cleanName = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);

  if (ext === "md" || ext === "markdown") {
    const text = bytes.toString("utf8");
    if (text.includes("�")) throw new StudioError(`"${name}" isn't valid UTF-8 text.`);
    const b = await addBlock(ownerId, lessonId, { kind: "markdown", text });
    return { kind: "markdown", blockId: b.id, name: cleanName };
  }
  if (ext === "json") {
    const report = await runImport(bytes.toString("utf8"), "json", { commit: true, authorId: ownerId }).catch((err) => {
      throw new StudioError(`"${name}": ${err instanceof Error ? err.message : "couldn't be read"}`);
    });
    const ids = report.questionIds.length ? report.questionIds : (await db.bankQuestion.findMany({ where: { externalId: { in: report.skipped.flatMap((s) => (s.externalId ? [s.externalId] : [])) } }, select: { id: true } })).map((q) => q.id);
    if (!ids.length) throw new StudioError(`"${name}": no good rows. ${report.rows.filter((r) => !r.ok).slice(0, 5).map((r) => `Row ${r.row}: ${r.errors.join(" ")}`).join(" ")}`);
    const skills = await db.bankQuestion.findMany({ where: { id: { in: ids } }, select: { skillId: true } });
    const set = await db.questionSet.create({ data: { title: `${lesson.title} · ${cleanName.replace(/\.json$/i, "")}`, authorId: ownerId, questionIds: ids, skillIds: [...new Set(skills.flatMap((s) => (s.skillId ? [s.skillId] : [])))], visibility: "public", status: "draft" } });
    const b = await addBlock(ownerId, lessonId, { kind: "question_set", setId: set.id });
    return { kind: "question_set", blockId: b.id, setId: set.id, imported: report.imported, failed: report.failed, skipped: report.skipped.length, problems: report.rows.filter((r) => !r.ok).map((r) => ({ row: r.row, externalId: r.externalId, errors: r.errors })) };
  }
  const id = randomBytes(12).toString("hex");
  const key = `studio/${lesson.unit.course.id}/${id}.${ext === "jpeg" ? "jpg" : ext}`;
  await storage.put(key, bytes, rule.type);
  const file = await db.studioFile.create({ data: { lessonId, name: cleanName, contentType: rule.type, sizeBytes: bytes.length, storageKey: key } });
  const b = await db.studioBlock.create({ data: { lessonId, kind: "file", data: { fileId: file.id }, order: await nextBlockOrder(lessonId) } });
  return { kind: "file", blockId: b.id, name: cleanName };
}

export async function studioSetOptions(ownerId: string) {
  await requireOwnerId(ownerId);
  return db.questionSet.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true, status: true } });
}
