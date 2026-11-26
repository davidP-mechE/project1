import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { storage } from "./storage";
import { skillResolver } from "@/lib/bank/import";
import { parseQbankItem, QBANK_IMAGE, qbankImageUrl, QbankFileSchema, QbankItemSchema, type QbankRow } from "@/lib/bank/qbank";
import { checkTranscript, showsText, textRow, validBox, type TextStatus, type Transcript } from "@/lib/bank/transcribe";
import type { ResultsFile } from "./qbank-transcribe";
import { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";

/**
 * Importing the in-house College Board Question Bank (npm run import:bank).
 * This is the one import path allowed to add College Board content; everything
 * it adds is in_house (src/server/in-house.ts). Safe to run again: items are
 * matched by College Board ID ("CB-<question_id>") and updated in place.
 * Images go to private storage and are served only through /api/bank/qbank/<name>.
 */

export const qbankImageKey = (name: string) => `bank/qbank/${name}`;

export type QbankReport = {
  items: number;
  created: number;
  updated: number;
  failed: { questionId: string; errors: string[] }[];
  bySection: Record<string, number>;
  byDifficulty: Record<string, number>;
  bySkill: Record<string, number>;
  images: { referenced: number; uploaded: number; alreadyStored: number; missing: string[] };
  notes: { questionId: string; note: string }[];
  committed: boolean;
  /** From qbank_transcriptions.json: shown as text, waiting for review, kept as an image by you. */
  text: { asText: number; review: number; keptImage: number; figures: number };
};

/** The fields that differ between an item's text and image versions. */
const VERSION_FIELDS = ["stem", "choices", "explanation", "imageUrl", "imageIsQuestion", "imageAlt", "rationaleImageUrl"] as const;
type Version = Pick<QbankRow, (typeof VERSION_FIELDS)[number]>;
const versionOf = (r: QbankRow): Version => Object.fromEntries(VERSION_FIELDS.map((k) => [k, r[k]])) as Version;
export type StoredTranscript = { text: Version; image: Version };

/** Cut the figure out of a question image (box as fractions), with a little margin. */
async function cropFigure(bytes: Buffer, b: NonNullable<Transcript["figure"]["box"]>): Promise<Buffer> {
  const { loadImage, createCanvas } = await import("@napi-rs/canvas");
  const img = await loadImage(bytes);
  const pad = 0.01;
  const x0 = Math.max(0, Math.floor((b.x0 - pad) * img.width));
  const y0 = Math.max(0, Math.floor((b.y0 - pad) * img.height));
  const x1 = Math.min(img.width, Math.ceil((b.x1 + pad) * img.width));
  const y1 = Math.min(img.height, Math.ceil((b.y1 + pad) * img.height));
  const c = createCanvas(x1 - x0, y1 - y0);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return c.encode("webp", 92);
}

const tally = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

async function inChunks<T>(xs: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < xs.length; i += size) await Promise.all(xs.slice(i, i + size).map(fn));
}

export async function importQuestionBank(opts: { json: string; imageDir: string; commit: boolean; transcriptions?: ResultsFile | null; onProgress?: (msg: string) => void }): Promise<QbankReport> {
  let file: unknown;
  try {
    file = JSON.parse(opts.json);
  } catch {
    throw new Error("The bank file isn't valid JSON.");
  }
  const head = QbankFileSchema.safeParse(file);
  if (!head.success) throw new Error(`Not a "coursebook-question-bank" version 1 file: ${head.error.issues[0]?.message ?? "unknown format"}`);
  const skills = await db.skill.findMany({ select: { id: true, section: true, name: true, parentId: true } });
  const resolve = skillResolver(skills);
  const names = new Map(skills.map((s) => [s.id, s.name]));
  const onDisk = new Set((await fs.readdir(opts.imageDir).catch(() => [] as string[])).filter((f) => QBANK_IMAGE.test(f)));

  const report: QbankReport = { items: head.data.items.length, created: 0, updated: 0, failed: [], bySection: {}, byDifficulty: {}, bySkill: {}, images: { referenced: 0, uploaded: 0, alreadyStored: 0, missing: [] }, notes: [], committed: opts.commit, text: { asText: 0, review: 0, keptImage: 0, figures: 0 } };
  const rows: QbankRow[] = [];
  const images = new Set<string>();
  const seen = new Set<string>();
  for (const raw of head.data.items) {
    const p = parseQbankItem(raw, resolve, head.data.source_detail ?? null);
    const missing = p.images.filter((img) => !onDisk.has(img));
    const errors = [...p.errors, ...missing.map((m) => `Image ${m} isn't in the image folder.`), ...(seen.has(p.questionId) ? ["Duplicate question_id."] : [])];
    report.images.missing.push(...missing);
    if (errors.length || !p.row) {
      report.failed.push({ questionId: p.questionId, errors });
      continue;
    }
    seen.add(p.questionId);
    if (p.note) report.notes.push({ questionId: p.questionId, note: p.note });
    p.images.forEach((i) => images.add(i));
    rows.push(p.row);
    tally(report.bySection, p.row.section === "math" ? "math" : "reading-writing");
    tally(report.byDifficulty, ["", "Easy", "Medium", "Hard"][p.row.difficulty]);
    tally(report.bySkill, names.get(p.row.skillId!) ?? "?");
  }
  report.images.referenced = images.size;

  const existingRows = await db.bankQuestion.findMany({ where: { externalId: { in: rows.map((r) => r.externalId) } }, select: { id: true, externalId: true, textStatus: true, transcript: true } });
  const existing = new Map(existingRows.map((q) => [q.externalId!, q.id]));
  const previous = new Map(existingRows.map((q) => [q.externalId!, q]));

  // Transcriptions: each image item gets a text version; it's shown when it passed every check (or you chose it).
  const items = new Map<string, z.infer<typeof QbankItemSchema>>(head.data.items.flatMap((raw) => {
    const r = QbankItemSchema.safeParse(raw);
    return r.success ? [[`CB-${r.data.question_id}`, r.data] as const] : [];
  }));
  const plans = new Map<string, { status: TextStatus; issues: string[]; stored: StoredTranscript; figure: { name: string; box: NonNullable<Transcript["figure"]["box"]>; from: string } | null }>();
  for (const r of rows) {
    const qid = r.externalId.replace(/^CB-/, "");
    const t = opts.transcriptions?.items[qid]?.transcript ?? null;
    const prev = previous.get(r.externalId);
    const decided = prev && (prev.textStatus === "approved_text" || prev.textStatus === "kept_image") ? (prev.textStatus as TextStatus) : null;
    if (!t) {
      // No new transcription: keep what's stored (and your decision).
      const stored = prev?.transcript as StoredTranscript | null | undefined;
      if (stored && prev) plans.set(r.externalId, { status: prev.textStatus as TextStatus, issues: [], stored: { text: stored.text, image: versionOf(r) }, figure: null });
      continue;
    }
    const item = items.get(r.externalId)!;
    const check = checkTranscript(t, item, { type: r.type, answer: r.answer });
    const box = t.figure.needed && validBox(t.figure.box) ? t.figure.box : null;
    const figure = box && item.question_image ? { name: `${qid}_fig.webp`, box, from: item.question_image } : null;
    const text = versionOf(textRow(r, t, figure ? qbankImageUrl(figure.name) : null, r.explanation));
    const status: TextStatus = decided ?? (check.ok ? "auto_text" : "review");
    plans.set(r.externalId, { status, issues: check.reasons, stored: { text, image: versionOf(r) }, figure });
  }
  for (const p of plans.values()) {
    if (showsText(p.status)) report.text.asText += 1;
    else if (p.status === "review") report.text.review += 1;
    else if (p.status === "kept_image") report.text.keptImage += 1;
    if (p.figure) report.text.figures += 1;
  }
  report.created = rows.filter((r) => !existing.has(r.externalId)).length;
  report.updated = rows.length - report.created;
  if (!opts.commit) return report;

  // Images first, so no question ever points at a missing file.
  let done = 0;
  await inChunks([...images], 8, async (name) => {
    const bytes = await fs.readFile(path.join(opts.imageDir, name));
    const stored = await storage.head(qbankImageKey(name));
    if (stored && stored.size === bytes.length) report.images.alreadyStored += 1;
    else {
      await storage.put(qbankImageKey(name), bytes, "image/webp");
      report.images.uploaded += 1;
    }
    if (++done % 500 === 0) opts.onProgress?.(`images: ${done}/${images.size}`);
  });

  // Figures cut out of transcribed questions.
  await inChunks([...plans.values()].flatMap((p) => (p.figure ? [p.figure] : [])), 8, async (f) => {
    await storage.put(qbankImageKey(f.name), await cropFigure(await fs.readFile(path.join(opts.imageDir, f.from)), f.box), "image/webp");
  });

  done = 0;
  await inChunks(rows, 20, async (row) => {
    const plan = plans.get(row.externalId);
    const r = plan
      ? { ...row, ...(showsText(plan.status) ? plan.stored.text : plan.stored.image), textStatus: plan.status, transcript: plan.stored as unknown as Prisma.InputJsonValue, transcriptIssues: plan.issues }
      : row;
    const id = existing.get(row.externalId);
    if (id) await db.bankQuestion.update({ where: { id }, data: { ...r } });
    else await db.bankQuestion.create({ data: { ...r, authorId: null } });
    if (++done % 500 === 0) opts.onProgress?.(`questions: ${done}/${rows.length}`);
  });
  return report;
}
