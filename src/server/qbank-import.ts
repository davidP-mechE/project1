import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { storage } from "./storage";
import { skillResolver } from "@/lib/bank/import";
import { parseQbankItem, QBANK_IMAGE, QbankFileSchema, type QbankRow } from "@/lib/bank/qbank";

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
};

const tally = (m: Record<string, number>, k: string) => void (m[k] = (m[k] ?? 0) + 1);

async function inChunks<T>(xs: T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < xs.length; i += size) await Promise.all(xs.slice(i, i + size).map(fn));
}

export async function importQuestionBank(opts: { json: string; imageDir: string; commit: boolean; onProgress?: (msg: string) => void }): Promise<QbankReport> {
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

  const report: QbankReport = { items: head.data.items.length, created: 0, updated: 0, failed: [], bySection: {}, byDifficulty: {}, bySkill: {}, images: { referenced: 0, uploaded: 0, alreadyStored: 0, missing: [] }, notes: [], committed: opts.commit };
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

  const existing = new Map((await db.bankQuestion.findMany({ where: { externalId: { in: rows.map((r) => r.externalId) } }, select: { id: true, externalId: true } })).map((q) => [q.externalId!, q.id]));
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

  done = 0;
  await inChunks(rows, 20, async (r) => {
    const id = existing.get(r.externalId);
    if (id) await db.bankQuestion.update({ where: { id }, data: { ...r } });
    else await db.bankQuestion.create({ data: { ...r, authorId: null } });
    if (++done % 500 === 0) opts.onProgress?.(`questions: ${done}/${rows.length}`);
  });
  return report;
}
