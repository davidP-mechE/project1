import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { storage, storageKeys } from "./storage";
import { enqueueGeneration } from "./queue";
import { rateLimit } from "./rate-limit";
import { assertAiBudget, LimitError } from "./limits";
import { isNoAi, NO_AI_MESSAGE } from "./program-access";
import { recordUsage } from "./usage";
import { NotFoundError } from "./courses";
import { staffForStudent } from "./scores";
import { AiError } from "./ai/writer";
import { getEssayGrader, type EssayGrader } from "./ai/academic-index";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { checkPdfSignature, PDF_HEAD_BYTES, PDF_TAIL_BYTES } from "@/lib/pdf/validate";
import { ESSAY_CRITERIA, ESSAY_SCORES_PER_DAY, FORMULA_VERSION, GRADING_RUNS, type ComponentKey, type EssayCriterion } from "@/lib/academic-index/config";
import { applyEssayRules, closestRun, essayTotal, medianCriteria, type EssayKind } from "@/lib/academic-index/essays";
import { normalizeRun, type NormalizedRun } from "@/lib/academic-index/essay-prompt";
import { FILE_TYPE_KEYS, FILE_TYPES, MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_SESSION, UPLOAD_TTL_HOURS, ExtractionSchema, lowConfidenceUnconfirmed, mergeExtractions, unconfirmed, type FileType } from "@/lib/academic-index/extraction";
import { CriteriaSchema, emptyInputs, InputsSchema, parseInputs, parseSources, type AcademicInputs, type CriteriaScores, type FieldSources } from "@/lib/academic-index/inputs";
import { computeAcademicIndex, leverOptions, validateInputs, type AcademicIndexResult, type Lever } from "@/lib/academic-index/score";

/**
 * The Academic Index (spec: "Coursebook Academic Index — Feature Spec").
 * Private by default: only the student sees their inputs and results; staff
 * see a student's results only for classes the student shared them with.
 */

export class AcademicIndexError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// ─── Age screen (COPPA) ──────────────────────────────────────────────────

export const MIN_AGE = 13;
export const AGE_BLOCKED_MESSAGE = "The Academic Index is only for students 13 or older. If you entered your birth date by mistake, ask your tutor or contact us.";

/** Whole years between a birth date (YYYY-MM-DD) and now, or null if the date isn't real. */
export function ageOn(birthDate: string, now = new Date()): number | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || date > now || y < 1900) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() < mo - 1 || (now.getUTCMonth() === mo - 1 && now.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * A neutral age screen before any application data is collected: the student
 * enters their birth date; under 13 is blocked (and stays blocked, so trying
 * another date doesn't work). Only the outcome is saved, never the date.
 */
export async function submitAgeCheck(userId: string, birthDate: string, now = new Date()) {
  const row = await db.academicIndexInputs.findUnique({ where: { userId }, select: { ageCheck: true } });
  if (row?.ageCheck === "BLOCKED") throw new AcademicIndexError(AGE_BLOCKED_MESSAGE, 403);
  if (row?.ageCheck === "PASSED") return "PASSED" as const;
  const age = ageOn(birthDate, now);
  if (age === null) throw new AcademicIndexError("Enter your date of birth.");
  const ageCheck = age >= MIN_AGE ? "PASSED" : "BLOCKED";
  await db.academicIndexInputs.upsert({
    where: { userId },
    create: { userId, ageCheck, ageCheckedAt: now },
    update: { ageCheck, ageCheckedAt: now },
  });
  if (ageCheck === "BLOCKED") throw new AcademicIndexError(AGE_BLOCKED_MESSAGE, 403);
  return ageCheck;
}

async function requireAgeOk(userId: string) {
  const row = await db.academicIndexInputs.findUnique({ where: { userId }, select: { ageCheck: true } });
  if (row?.ageCheck === "BLOCKED") throw new AcademicIndexError(AGE_BLOCKED_MESSAGE, 403);
  if (row?.ageCheck !== "PASSED") throw new AcademicIndexError("Confirm your date of birth first.", 403);
}

// ─── Inputs (drafts) ─────────────────────────────────────────────────────

/** Saved essays only if the student chose to keep them. */
const forStorage = (inputs: AcademicInputs, keepEssays: boolean): AcademicInputs =>
  keepEssays ? inputs : { ...inputs, essays: { personalStatement: "", supplements: inputs.essays.supplements.map((s) => ({ ...s, text: "" })) } };

export async function getAcademicIndex(userId: string) {
  const [row, uploads, results, shares, classes] = await Promise.all([
    db.academicIndexInputs.findUnique({ where: { userId } }),
    db.academicIndexUpload.findMany({ where: { userId, status: { not: "UPLOADING" }, uploadedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { uploadedAt: "desc" }, take: 20, select: { id: true, fileType: true, status: true, error: true, pageCount: true, uploadedAt: true, deletedAt: true, appliedAt: true } }),
    db.academicIndexResult.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, total: true, tier: true, estimateType: true, createdAt: true } }),
    db.academicIndexShare.findMany({ where: { userId }, select: { classId: true } }),
    db.classMember.findMany({ where: { userId, class: { archivedAt: null } }, select: { class: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } }),
  ]);
  return {
    ageCheck: (row?.ageCheck ?? null) as "PASSED" | "BLOCKED" | null,
    inputs: row ? parseInputs(row.inputs) : emptyInputs(),
    sources: row ? parseSources(row.fieldSources) : {},
    keepEssays: row?.keepEssays ?? false,
    isDraft: row?.isDraft ?? true,
    updatedAt: row?.updatedAt ?? null,
    uploads,
    results,
    sharedClassIds: shares.map((s) => s.classId),
    classes: classes.map((c) => c.class),
  };
}

/**
 * Keep the stored "confirmed" flag for sources the student still has: confirming
 * only happens through confirmReview. Sources the form no longer has are dropped.
 */
function mergeSourceFlags(stored: FieldSources, incoming: FieldSources): FieldSources {
  const out: FieldSources = {};
  for (const [k, v] of Object.entries(incoming)) out[k] = { ...v, confirmed: stored[k]?.confirmed ?? false };
  return out;
}

export type DraftInput = { inputs: unknown; sources: unknown; keepEssays: boolean };

function parseDraft(d: DraftInput) {
  const r = InputsSchema.safeParse(d.inputs);
  if (!r.success) throw new AcademicIndexError("Some answers couldn't be read. Please check the form.");
  return { inputs: r.data, sources: parseSources(d.sources), keepEssays: Boolean(d.keepEssays) };
}

export async function saveDraft(userId: string, draft: DraftInput) {
  await requireAgeOk(userId);
  const d = parseDraft(draft);
  const row = await db.academicIndexInputs.findUniqueOrThrow({ where: { userId } });
  const sources = mergeSourceFlags(parseSources(row.fieldSources), d.sources);
  await db.academicIndexInputs.update({
    where: { userId },
    data: { inputs: forStorage(d.inputs, d.keepEssays), fieldSources: sources, keepEssays: d.keepEssays, isDraft: true },
  });
  return { needed: validateInputs(d.inputs) };
}

/**
 * The student confirmed the review screen: every low-confidence field must be
 * ticked; then all filled-in fields count as checked, and the raw PDFs are
 * deleted (keeping only the confirmed fields).
 */
export async function confirmReview(userId: string, draft: DraftInput & { ticked: string[] }) {
  await requireAgeOk(userId);
  const d = parseDraft(draft);
  const row = await db.academicIndexInputs.findUniqueOrThrow({ where: { userId } });
  const stored = parseSources(row.fieldSources);
  const ticked = new Set(draft.ticked);
  const sources = mergeSourceFlags(stored, d.sources);
  for (const [k, s] of Object.entries(sources)) if (s.confidence === "low" && ticked.has(k)) s.confirmed = true;
  const missing = lowConfidenceUnconfirmed(sources);
  if (missing.length) throw new AcademicIndexError(`Check and tick the ${missing.length} highlighted field${missing.length === 1 ? "" : "s"} first.`);
  for (const s of Object.values(sources)) s.confirmed = true;
  await db.academicIndexInputs.update({ where: { userId }, data: { inputs: forStorage(d.inputs, d.keepEssays), fieldSources: sources, keepEssays: d.keepEssays } });
  const reviewed = await db.academicIndexUpload.findMany({ where: { userId, appliedAt: { not: null }, status: "EXTRACTED" } });
  for (const u of reviewed) await deleteUploadFile(u.id, "CONFIRMED");
  return { deleted: reviewed.length };
}

// ─── PDF import ──────────────────────────────────────────────────────────

const ACTIVE = ["UPLOADING", "UPLOADED", "EXTRACTED"];

/** Step 1: check the upload and hand back a URL to put the PDF at. */
export async function createImportUpload(userId: string, input: { fileType: string; size: number; contentType: string }) {
  await requireAgeOk(userId);
  if (await isNoAi(userId)) throw new AcademicIndexError(`${NO_AI_MESSAGE} You can still enter everything by hand.`, 403);
  if (!FILE_TYPE_KEYS.includes(input.fileType as FileType)) throw new AcademicIndexError("Choose which file this is.");
  if (input.contentType !== "application/pdf") throw new AcademicIndexError("Upload a PDF.");
  if (!(input.size > 0)) throw new AcademicIndexError("That file is empty.");
  if (input.size > MAX_UPLOAD_BYTES) throw new AcademicIndexError("PDFs can be up to 20 MB.");
  const active = await db.academicIndexUpload.count({ where: { userId, status: { in: ACTIVE } } });
  if (active >= MAX_UPLOADS_PER_SESSION) throw new AcademicIndexError(`Up to ${MAX_UPLOADS_PER_SESSION} files at a time. Review the files you've uploaded (or remove one) first.`);
  const limited = await rateLimit(RATE_RULES.academicUpload, userId);
  if (!limited.ok) throw new AcademicIndexError(`You've uploaded a lot of files today. Please try again in ${Math.ceil(limited.retryAfterSeconds / 3600)} hours.`, 429);
  try {
    await assertAiBudget(userId);
  } catch (err) {
    if (err instanceof LimitError) throw new AcademicIndexError(err.message, 429);
    throw err;
  }
  const row = await db.academicIndexUpload.create({ data: { userId, fileType: input.fileType, sizeBytes: input.size } });
  const storageKey = storageKeys.academicUpload(userId, row.id);
  await db.academicIndexUpload.update({ where: { id: row.id }, data: { storageKey } });
  const upload = await storage.createUploadUrl(storageKey, { contentType: "application/pdf", contentLength: input.size, expiresInSeconds: 3600 });
  return { uploadId: row.id, upload };
}

/** Step 3: the PDF is uploaded; check it and have it read in the background. */
export async function completeImportUpload(userId: string, uploadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await db.academicIndexUpload.findFirst({ where: { id: uploadId, userId } });
  if (!u || !u.storageKey) throw new NotFoundError("Upload not found");
  if (u.status !== "UPLOADING") return { ok: true };
  const fail = async (error: string) => {
    await storage.delete(u.storageKey!).catch(() => {});
    await db.academicIndexUpload.update({ where: { id: u.id }, data: { status: "FAILED", error, storageKey: null, deletedAt: new Date() } });
    return { ok: false as const, error };
  };
  const stored = await storage.head(u.storageKey);
  if (!stored) return fail("The upload didn't finish. Please try again.");
  if (stored.size !== u.sizeBytes) return fail("The uploaded file size doesn't match. Please try again.");
  const head = await storage.readRange(u.storageKey, 0, PDF_HEAD_BYTES - 1);
  const tail = await storage.readRange(u.storageKey, Math.max(0, stored.size - PDF_TAIL_BYTES), stored.size - 1);
  const check = checkPdfSignature(head, tail);
  if (!check.ok) return fail(check.reason);
  await db.academicIndexUpload.update({ where: { id: u.id }, data: { status: "UPLOADED", error: null } });
  await enqueueGeneration([{ payload: { kind: "academic-index-extract", uploadId: u.id }, priority: 2 }]);
  return { ok: true };
}

/** Delete an upload's PDF now. Extracted fields go too (unless they were already put on the review screen). */
export async function deleteUploadFile(uploadId: string, status: "CONFIRMED" | "DELETED" | "FAILED" = "DELETED", error?: string) {
  const u = await db.academicIndexUpload.findUnique({ where: { id: uploadId } });
  if (!u) return;
  if (u.storageKey) await storage.delete(u.storageKey).catch((err) => console.warn("[academic-index] couldn't delete an upload:", err instanceof Error ? err.message : err));
  await db.academicIndexUpload.update({
    where: { id: uploadId },
    data: { status, storageKey: null, extracted: Prisma.DbNull, deletedAt: u.deletedAt ?? new Date(), ...(error ? { error } : {}) },
  });
}

export async function removeUpload(userId: string, uploadId: string) {
  const u = await db.academicIndexUpload.findFirst({ where: { id: uploadId, userId } });
  if (!u) throw new NotFoundError("Upload not found");
  if (u.deletedAt) return;
  await deleteUploadFile(u.id, "DELETED");
}

/** Put every newly read file's fields on the review screen (the inputs, with sources). */
export async function applyExtractions(userId: string) {
  await requireAgeOk(userId);
  const ready = await db.academicIndexUpload.findMany({ where: { userId, status: "EXTRACTED", appliedAt: null }, orderBy: { uploadedAt: "asc" } });
  const files = ready.flatMap((u) => {
    const r = ExtractionSchema.safeParse(u.extracted);
    return r.success ? [{ uploadId: u.id, fileType: u.fileType as FileType, extraction: r.data }] : [];
  });
  if (files.length === 0) return { applied: 0 };
  const row = await db.academicIndexInputs.findUniqueOrThrow({ where: { userId } });
  const merged = mergeExtractions(parseInputs(row.inputs), parseSources(row.fieldSources), files);
  // Essays read from the Common App are shown on the review screen; they're stored only if the student keeps them.
  await db.$transaction([
    db.academicIndexInputs.update({ where: { userId }, data: { inputs: merged.inputs, fieldSources: merged.sources, isDraft: true } }),
    db.academicIndexUpload.updateMany({ where: { id: { in: files.map((f) => f.uploadId) } }, data: { appliedAt: new Date() } }),
  ]);
  return { applied: files.length };
}

/**
 * Hourly (worker maintenance): raw PDFs are deleted 24 hours after upload if
 * the student never confirmed the review, and abandoned uploads are cleared.
 */
export async function purgeExpiredUploads(now = new Date()) {
  const cutoff = new Date(now.getTime() - UPLOAD_TTL_HOURS * 3600_000);
  const stale = await db.academicIndexUpload.findMany({ where: { deletedAt: null, uploadedAt: { lt: cutoff } }, select: { id: true, status: true } });
  for (const u of stale) await deleteUploadFile(u.id, u.status === "FAILED" ? "FAILED" : "DELETED");
  return stale.length;
}

// ─── Essays ──────────────────────────────────────────────────────────────

export type GradedEssay = {
  kind: EssayKind;
  prompt: string;
  score: number;
  criteria: CriteriaScores;
  feedback: Record<EssayCriterion, { evidence: string; suggestion: string }>;
  warnings: string[];
  wordCount: number;
  limit: number | null;
};
export type EssayGrades = { personalStatement: GradedEssay | null; supplements: GradedEssay[]; grader: "claude" | "demo" | null; pendingReason: string | null };

type EssayJob = { kind: EssayKind; prompt: string; wordLimit: number | null; text: string };
type StoredGrade = { criteria: CriteriaScores; feedback: Record<EssayCriterion, { evidence: string; suggestion: string }>; answersPrompt: boolean; promptNote: string };

const essayHash = (e: EssayJob, grader: string) => createHash("sha256").update(JSON.stringify([FORMULA_VERSION, grader, e.kind, e.prompt.trim(), e.text.trim()])).digest("hex");

/** Essay scoring requests in the last 24 hours (each "Score" press that graded at least one changed essay). */
export async function essayRequestsToday(userId: string, now = new Date()) {
  const rows = await db.academicEssayGrade.findMany({ where: { userId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, distinct: ["requestId"], select: { requestId: true } });
  return rows.length;
}

async function gradeOne(grader: EssayGrader, e: EssayJob) {
  const calls = [];
  const runs: NormalizedRun[] = [];
  const results = await Promise.allSettled(Array.from({ length: GRADING_RUNS }, () => grader.grade({ kind: e.kind, prompt: e.prompt, text: e.text })));
  let failure: unknown = null;
  for (const r of results) {
    if (r.status === "fulfilled") {
      calls.push(...r.value.calls);
      runs.push(normalizeRun(r.value.value));
    } else {
      failure ??= r.reason;
      if (r.reason instanceof AiError) calls.push(...r.reason.calls);
    }
  }
  return { runs, calls, failure };
}

/**
 * Grade the essays: each 3 times, keeping each criterion's median (and the
 * quotes and suggestions of the run closest to it). An essay that hasn't
 * changed since it was last graded reuses that grade. Then the word-limit and
 * prompt rules are applied in code.
 */
export async function gradeEssays(userId: string, inputs: AcademicInputs, deps: { grader?: EssayGrader | null; now?: Date } = {}): Promise<EssayGrades> {
  const ps = inputs.essays.personalStatement.trim();
  const none: EssayGrades = { personalStatement: null, supplements: [], grader: null, pendingReason: null };
  if (!ps) return { ...none, pendingReason: "Add your personal statement to score your essays." };
  if (await isNoAi(userId)) return { ...none, pendingReason: "Essay scoring uses AI, which isn't available on your account." };
  const grader = deps.grader === undefined ? getEssayGrader() : deps.grader;
  if (!grader) return { ...none, pendingReason: "Essay scoring isn't set up on this server yet." };

  const jobs: EssayJob[] = [
    { kind: "personal_statement", prompt: "", wordLimit: null, text: ps },
    ...inputs.essays.supplements.filter((s) => s.text.trim()).map((s) => ({ kind: "supplement" as const, prompt: s.prompt, wordLimit: s.wordLimit, text: s.text.trim() })),
  ];
  const hashes = jobs.map((j) => essayHash(j, grader.kind));
  const cached = new Map<string, StoredGrade>();
  const rows = await db.academicEssayGrade.findMany({ where: { userId, essayHash: { in: hashes } }, orderBy: { createdAt: "desc" } });
  for (const r of rows) if (!cached.has(r.essayHash)) cached.set(r.essayHash, { criteria: CriteriaSchema.parse(r.criteria), ...(r.feedback as Omit<StoredGrade, "criteria">) });

  const todo = jobs.map((j, i) => ({ j, h: hashes[i] })).filter((x) => !cached.has(x.h));
  if (todo.length) {
    if ((await essayRequestsToday(userId, deps.now)) >= ESSAY_SCORES_PER_DAY) {
      throw new AcademicIndexError(`You can score changed essays ${ESSAY_SCORES_PER_DAY} times a day. Try again tomorrow; your other answers can still be scored now if you undo your essay changes.`, 429);
    }
    try {
      await assertAiBudget(userId);
    } catch (err) {
      if (err instanceof LimitError) throw new AcademicIndexError(err.message, 429);
      throw err;
    }
    const requestId = randomUUID();
    const graded = await Promise.all(todo.map((t) => gradeOne(grader, t.j)));
    await recordUsage({ userId, feature: "ESSAY_GRADING" }, graded.flatMap((g) => g.calls));
    const failed = graded.find((g) => g.runs.length < GRADING_RUNS);
    if (failed) {
      const ai = failed.failure instanceof AiError ? failed.failure : null;
      if (!ai) console.error("[academic-index] essay grading failed:", failed.failure);
      throw new AcademicIndexError(ai?.userMessage ?? "Your essays couldn't be scored. Please try again.", ai?.kind === "retryable" ? 503 : 400);
    }
    for (let i = 0; i < todo.length; i++) {
      const runs = graded[i].runs;
      const criteria = medianCriteria(runs.map((r) => r.criteria));
      const closest = closestRun(runs, criteria);
      const answersPrompt = runs.filter((r) => r.answersPrompt).length * 2 > runs.length;
      const stored: StoredGrade = { criteria, feedback: closest.feedback, answersPrompt, promptNote: answersPrompt ? "" : (runs.find((r) => !r.answersPrompt)?.promptNote ?? "") };
      cached.set(todo[i].h, stored);
      await db.academicEssayGrade.create({
        data: { userId, essayHash: todo[i].h, requestId, criteria, feedback: { feedback: stored.feedback, answersPrompt, promptNote: stored.promptNote }, model: grader.kind === "demo" ? "demo" : "claude" },
      });
    }
  }

  const finish = (j: EssayJob, h: string): GradedEssay => {
    const g = cached.get(h)!;
    const ruled = applyEssayRules(g.criteria, { kind: j.kind, text: j.text, wordLimit: j.wordLimit, answersPrompt: g.answersPrompt, promptNote: g.promptNote });
    return { kind: j.kind, prompt: j.prompt, score: essayTotal(ruled.criteria), criteria: ruled.criteria, feedback: g.feedback, warnings: ruled.warnings, wordCount: ruled.wordCount, limit: ruled.limit };
  };
  const all = jobs.map((j, i) => finish(j, hashes[i]));
  return { personalStatement: all[0], supplements: all.slice(1), grader: grader.kind, pendingReason: null };
}


// ─── Scoring ─────────────────────────────────────────────────────────────

export type ResultDetail = AcademicIndexResult["detail"] & {
  components: AcademicIndexResult["components"];
  labels: string[];
  tierMessage: string;
  levers: Lever[];
  essayNote: string | null;
};

/** Score the inputs: save them, grade the essays, and save a result. */
export async function scoreAcademicIndex(userId: string, draft: DraftInput, deps: { grader?: EssayGrader | null; now?: Date } = {}) {
  await saveDraft(userId, draft);
  const d = parseDraft(draft);
  const row = await db.academicIndexInputs.findUniqueOrThrow({ where: { userId } });
  const pending = unconfirmed(parseSources(row.fieldSources));
  if (pending.length) throw new AcademicIndexError("Some fields were filled from your PDFs and haven't been checked yet. Check them and press Confirm first.");
  const needed = validateInputs(d.inputs);
  if (needed.length) throw new AcademicIndexError(needed[0].message);

  const essays = await gradeEssays(userId, d.inputs, deps);
  const scoring = {
    ...d.inputs,
    essayScores: { personalStatement: essays.personalStatement?.criteria ?? null, supplements: essays.supplements.map((s) => s.criteria) },
  };
  const r = computeAcademicIndex(scoring);
  const levers = leverOptions(scoring);
  const detail: ResultDetail = { ...r.detail, components: r.components, labels: r.labels, tierMessage: r.tierMessage, levers, essayNote: essays.pendingReason };
  const result = await db.academicIndexResult.create({
    data: {
      userId,
      formulaVersion: r.formulaVersion,
      testPoints: r.components.test.present ? r.components.test.earned : null,
      gpaPoints: r.components.gpa.earned,
      rigorPoints: r.components.rigor.earned,
      activityPoints: r.components.activities.earned,
      essayPoints: r.components.essays.present ? r.components.essays.earned : null,
      essayFeedback: { grader: essays.grader, personalStatement: essays.personalStatement, supplements: essays.supplements },
      detail,
      total: r.total,
      tier: r.tier,
      estimateType: r.estimateType,
    },
  });
  await db.academicIndexInputs.update({ where: { userId }, data: { isDraft: false } });
  return { resultId: result.id, total: r.total, tier: r.tier };
}

export type StoredResult = Awaited<ReturnType<typeof getResult>>;

function shapeResult(row: NonNullable<Awaited<ReturnType<typeof db.academicIndexResult.findFirst>>>) {
  const detail = row.detail as unknown as ResultDetail;
  const fb = row.essayFeedback as unknown as { grader: "claude" | "demo" | null; personalStatement: GradedEssay | null; supplements: GradedEssay[] };
  return { ...row, detail, essays: { grader: fb.grader ?? null, personalStatement: fb.personalStatement ?? null, supplements: fb.supplements ?? [] } };
}

export async function getResult(userId: string, resultId: string) {
  const row = await db.academicIndexResult.findFirst({ where: { id: resultId, userId } });
  if (!row) throw new NotFoundError("Result not found");
  return shapeResult(row);
}

export async function deleteResult(userId: string, resultId: string) {
  const { count } = await db.academicIndexResult.deleteMany({ where: { id: resultId, userId } });
  if (!count) throw new NotFoundError("Result not found");
}

// ─── Sharing ─────────────────────────────────────────────────────────────

/** Share the index with these of the student's classes (and stop sharing with the rest). */
export async function setShares(userId: string, classIds: string[]) {
  const mine = await db.classMember.findMany({ where: { userId, classId: { in: classIds } }, select: { classId: true } });
  const allowed = mine.map((m) => m.classId);
  await db.$transaction([
    db.academicIndexShare.deleteMany({ where: { userId, classId: { notIn: allowed } } }),
    ...allowed.map((classId) => db.academicIndexShare.upsert({ where: { userId_classId: { userId, classId } }, create: { userId, classId }, update: {} })),
  ]);
  return { shared: allowed.length };
}

/**
 * Staff: a student's results, only if the student shared them with this class
 * and the student is in the caller's scope (else null / not found). No essays:
 * the student's scores, breakdown and history only.
 */
export async function sharedIndexForStaff(actorId: string, classId: string, studentId: string) {
  await staffForStudent(actorId, classId, studentId);
  const share = await db.academicIndexShare.findUnique({ where: { userId_classId: { userId: studentId, classId } } });
  if (!share) return null;
  const rows = await db.academicIndexResult.findMany({ where: { userId: studentId }, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return { latest: null, history: [] };
  const latest = shapeResult(rows.at(-1)!);
  return {
    latest: { id: latest.id, total: latest.total, tier: latest.tier, estimateType: latest.estimateType, createdAt: latest.createdAt, formulaVersion: latest.formulaVersion, components: latest.detail.components, labels: latest.detail.labels, tierMessage: latest.detail.tierMessage },
    history: rows.map((r) => ({ total: r.total, createdAt: r.createdAt })),
  };
}

export const COMPONENT_ORDER: ComponentKey[] = ["test", "gpa", "rigor", "activities", "essays"];
export { FILE_TYPES, ESSAY_CRITERIA };
