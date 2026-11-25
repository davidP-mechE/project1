import { z } from "zod";
import { CalloutDataSchema, CheckpointDataSchema, DesmosStepsSchema, VideoDataSchema, videoFromUrl } from "./blocks";

/**
 * Course packets ("coursebook-course-packet", version 1): course → units →
 * lessons → blocks, read into the Course Studio's shape. Pure. Unknown fields
 * are ignored; unknown block types (and blocks that don't fit their type) are
 * skipped with a warning instead of failing the import.
 */

const str = (max: number) => z.string().max(max);
const optStr = (max: number) => str(max).optional().nullable();

const CourseSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  title: str(160),
  section: z.enum(["math", "ebrw", "other"]).catch("other"),
  program: optStr(200),
  description: optStr(4000),
  status: optStr(20),
  visibility: optStr(20),
  estimated_hours: z.number().optional().nullable(),
  units: z.array(z.unknown()),
});
const UnitSchema = z.object({ id: str(60), number: z.union([z.number(), z.string()]).optional().nullable(), title: str(160), summary: optStr(4000), lessons: z.array(z.unknown()).default([]), review_sets: z.array(z.unknown()).default([]) });
const LessonSchema = z.object({
  id: str(60),
  number: z.union([z.number(), z.string()]).optional().nullable(),
  title: str(160),
  estimated_minutes: z.number().optional().nullable(),
  objectives: z.array(str(1000)).default([]),
  skills: z.array(str(200)).default([]),
  blueprints: z.array(str(40)).default([]),
  blocks: z.array(z.unknown()).default([]),
});
export const PacketSetSchema = z.object({
  set_id: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  title: str(200),
  status: optStr(20),
  mode: optStr(40),
  note: optStr(2000),
  question_ids: z.array(z.string().max(40)).max(200),
  source: optStr(40),
  visibility: optStr(40),
  skills: z.array(str(200)).default([]),
  blueprints: z.array(str(40)).default([]),
});
export type PacketSet = z.infer<typeof PacketSetSchema>;

export type BlockSpec =
  | { kind: "markdown"; key: string; data: { text: string } }
  | { kind: "video" | "callout" | "checkpoint" | "desmos"; key: string; data: Record<string, unknown> }
  | { kind: "question_set"; key: string; set: PacketSet };
export type LessonSpec = { key: string; number: string | null; title: string; estimatedMinutes: number | null; objectives: string[]; skills: string[]; blueprints: string[]; blocks: BlockSpec[] };
export type UnitSpec = { key: string; title: string; summary: string; lessons: LessonSpec[] };
export type CourseSpec = { slug: string; title: string; section: "math" | "ebrw" | "other"; program: string | null; description: string; estimatedHours: number | null; units: UnitSpec[]; ownerOnlyDraft: boolean };
export type PacketParse = { course: CourseSpec | null; warnings: string[]; errors: string[] };

/**
 * Dollar amounts ("$35", "$2.25", "$24,000") and a lone "$" are money, not the start of $…$ math:
 * escape them so the Markdown renderer shows a dollar sign. "$2x + 3$" (a digit then a letter or
 * operator) is still math.
 */
export function escapeCurrency(text: string): string {
  return (
    text
      // "$35", "$2.25", "$24,000" (not "$2x", "$3^2", "$3$"): a dollar amount.
      .replace(/(^|[^\\])\$(?=\d[\d,]*(?:\.\d+)?(?![\d,]*[A-Za-z^_\\{(=+/<>$]))/g, "$1\\$")
      // A lone "$" between spaces ("%, $ or commas").
      .replace(/(^|\s)\$(?=\s)/g, "$1\\$")
  );
}
const escapeDeep = <T>(v: T, skip: Set<string> = new Set(["expressions", "url", "videoId", "playlistId"])): T => {
  if (typeof v === "string") return escapeCurrency(v) as T;
  if (Array.isArray(v)) return v.map((x) => escapeDeep(x, skip)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skip.has(k) ? x : escapeDeep(x, skip)])) as T;
  return v;
};

const issue = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; ");

/** One block → its Studio form. `counts` numbers blocks of each kind in the lesson, for stable keys. */
function readBlock(raw: unknown, where: string, counts: Map<string, number>, warn: (m: string) => void): BlockSpec | null {
  const b = raw as Record<string, unknown>;
  const type = typeof b?.type === "string" ? b.type : "";
  const nth = (k: string) => {
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return `${k}:${n}`;
  };
  switch (type) {
    case "markdown": {
      if (typeof b.content !== "string" || !b.content.trim()) return warn(`${where}: a markdown block has no content (skipped).`), null;
      return { kind: "markdown", key: nth("markdown"), data: { text: escapeCurrency(b.content.slice(0, 100_000)) } };
    }
    case "video": {
      const url = typeof b.url === "string" ? b.url : b.video_id ? `https://www.youtube.com/watch?v=${b.video_id}` : b.playlist_id ? `https://www.youtube.com/playlist?list=${b.playlist_id}` : "";
      const status = VideoDataSchema.shape.reviewStatus.safeParse(b.review_status);
      const v = videoFromUrl(url, String(b.title ?? ""), String(b.why_watch ?? ""), status.success ? status.data : "unreviewed");
      if (!v) return warn(`${where}: a video with link "${url}" isn't a YouTube video or playlist (skipped).`), null;
      // Keyed by the video itself, so approvals survive the packet reordering its blocks.
      return { kind: "video", key: `video:${v.videoId ?? v.playlistId}`, data: v };
    }
    case "callout": {
      const c = CalloutDataSchema.safeParse(b);
      if (!c.success) return warn(`${where}: a callout couldn't be read (${issue(c.error)}; skipped).`), null;
      return { kind: "callout", key: nth("callout"), data: escapeDeep(c.data) };
    }
    case "checkpoint": {
      const c = CheckpointDataSchema.safeParse(b);
      if (!c.success) return warn(`${where}: a checkpoint couldn't be read (${issue(c.error)}; skipped).`), null;
      return { kind: "checkpoint", key: nth("checkpoint"), data: escapeDeep(c.data) };
    }
    case "desmos": {
      const d = DesmosStepsSchema.safeParse({ ...b, useWhen: b.use_when, watchOut: b.watch_out });
      if (!d.success) return warn(`${where}: a Desmos panel couldn't be read (${issue(d.error)}; skipped).`), null;
      return { kind: "desmos", key: nth("desmos"), data: escapeDeep(d.data) };
    }
    case "question_set": {
      const s = PacketSetSchema.safeParse(b);
      if (!s.success) return warn(`${where}: a question set couldn't be read (${issue(s.error)}; skipped).`), null;
      return { kind: "question_set", key: `set:${s.data.set_id}`, set: s.data };
    }
    default:
      warn(`${where}: unknown block type "${type || "(none)"}" (skipped).`);
      return null;
  }
}

export function parsePacket(json: unknown): PacketParse {
  const warnings: string[] = [];
  const warn = (m: string) => void warnings.push(m);
  const f = json as Record<string, unknown>;
  if (f?.format !== "coursebook-course-packet") return { course: null, warnings, errors: [`Not a course packet (format is "${String(f?.format ?? "")}").`] };
  if (f.format_version !== 1) return { course: null, warnings, errors: [`Course packet version ${String(f.format_version)} isn't supported (only version 1).`] };
  const c = CourseSchema.safeParse(f.course);
  if (!c.success) return { course: null, warnings, errors: [`Course: ${issue(c.error)}`] };
  const units: UnitSpec[] = [];
  for (const [ui, rawUnit] of c.data.units.entries()) {
    const u = UnitSchema.safeParse(rawUnit);
    if (!u.success) {
      warn(`Unit ${ui + 1}: couldn't be read (${issue(u.error)}; skipped).`);
      continue;
    }
    const lessons: LessonSpec[] = [];
    for (const [li, rawLesson] of u.data.lessons.entries()) {
      const l = LessonSchema.safeParse(rawLesson);
      if (!l.success) {
        warn(`${u.data.id} lesson ${li + 1}: couldn't be read (${issue(l.error)}; skipped).`);
        continue;
      }
      const counts = new Map<string, number>();
      const blocks = l.data.blocks.map((b) => readBlock(b, l.data.id, counts, warn)).filter((b): b is BlockSpec => Boolean(b));
      lessons.push({
        key: l.data.id,
        number: l.data.number === undefined || l.data.number === null ? null : String(l.data.number),
        title: l.data.title,
        estimatedMinutes: l.data.estimated_minutes ? Math.round(l.data.estimated_minutes) : null,
        objectives: l.data.objectives,
        skills: l.data.skills,
        blueprints: l.data.blueprints,
        blocks,
      });
    }
    // Unit review sets: a last lesson in the unit, so they show at its end.
    const counts = new Map<string, number>();
    const reviews = u.data.review_sets.map((s) => readBlock({ type: "question_set", ...(s as object) }, `${u.data.id} review`, counts, warn)).filter((b): b is BlockSpec => Boolean(b));
    if (reviews.length) {
      lessons.push({ key: `${u.data.id}-review`, number: null, title: `${u.data.title}: review`, estimatedMinutes: null, objectives: ["Mixed practice on everything in this unit."], skills: [], blueprints: [], blocks: reviews });
    }
    const num = u.data.number === undefined || u.data.number === null ? "" : `Unit ${u.data.number}: `;
    units.push({ key: u.data.id, title: `${num}${u.data.title}`.slice(0, 160), summary: u.data.summary ?? "", lessons });
  }
  return {
    errors: [],
    warnings,
    course: {
      slug: c.data.slug,
      title: c.data.title,
      section: c.data.section,
      program: c.data.program ?? null,
      description: c.data.description ?? "",
      estimatedHours: c.data.estimated_hours ? Math.round(c.data.estimated_hours) : null,
      units,
      ownerOnlyDraft: true,
    },
  };
}

/** Every question set in a parsed course. */
export const packetSets = (c: CourseSpec) => c.units.flatMap((u) => u.lessons.flatMap((l) => l.blocks.flatMap((b) => (b.kind === "question_set" ? [b.set] : []))));
