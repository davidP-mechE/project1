import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { NotFoundError } from "@/server/courses";
import { createClass, joinClass } from "@/server/classes";
import { createProgram } from "@/server/programs";
import { setAccessRule } from "@/server/program-access";
import { AiError } from "@/server/ai/writer";
import type { ApplicationReader, EssayGrader } from "@/server/ai/academic-index";
import {
  AcademicIndexError,
  AGE_BLOCKED_MESSAGE,
  applyExtractions,
  completeImportUpload,
  confirmReview,
  createImportUpload,
  essayRequestsToday,
  getAcademicIndex,
  getResult,
  purgeExpiredUploads,
  saveDraft,
  scoreAcademicIndex,
  setShares,
  sharedIndexForStaff,
  submitAgeCheck,
} from "@/server/academic-index";
import { runAcademicExtractJob } from "@/server/academic-index-job";
import { emptyInputs, type AcademicInputs } from "@/lib/academic-index/inputs";
import type { Extraction } from "@/lib/academic-index/extraction";
import type { EssayRun } from "@/lib/academic-index/essay-prompt";
import { createUser, resetDb } from "../helpers/db";
import { makePdf } from "../helpers/pdf";

/** The Academic Index end to end: age screen, PDF import and review, essay grading, scoring, sharing. */

const queued: unknown[] = [];
vi.mock("@/server/queue", async (orig) => ({ ...(await orig<typeof import("@/server/queue")>()), enqueueGeneration: async (jobs: unknown[]) => void queued.push(...jobs) }));
vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

beforeEach(async () => {
  await resetDb();
  queued.length = 0;
});

const NOW = new Date("2026-11-25T12:00:00Z");

async function student(name = "Ana") {
  const u = await createUser(name);
  await submitAgeCheck(u.id, "2009-03-14", NOW);
  return u;
}

const field = <T>(value: T, page: number | null = 1, confidence: "high" | "low" = "high") => ({ value, page, confidence });
function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    documentKind: "other",
    problem: "",
    satSittings: [],
    actComposite: field(null, null),
    gpa: { value: null, scale: null, weighting: "unknown", page: null, confidence: "high" },
    courses: [],
    apExams: [],
    ibExams: [],
    activities: [],
    honors: [],
    personalStatement: field(null, null),
    supplements: [],
    ...over,
  };
}

class FakeReader implements ApplicationReader {
  calls: { fileType: string; pages: { page: number; text: string }[] }[] = [];
  constructor(private readonly byType: Record<string, Extraction>) {}
  async read(input: { fileType: string; pages: { page: number; text: string }[] }) {
    this.calls.push(input);
    return { value: this.byType[input.fileType] ?? extraction(), calls: [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 4000, outputTokens: 900 } }] };
  }
}
const fakeOcr = { calls: 0, async recognize() { this.calls += 1; return { text: "SCANNED PAGE: SAT Math 730", confidence: 90 }; } };

/** Grades every essay with these scores; counts calls. Odd runs vary so the median matters. */
class FakeGrader implements EssayGrader {
  readonly kind = "claude" as const;
  calls = 0;
  fail: AiError | null = null;
  constructor(public scores: [number, number, number, number, number] = [4, 4, 3, 4, 5], public answersPrompt = true) {}
  async grade() {
    this.calls += 1;
    if (this.fail) throw this.fail;
    const jitter = this.calls % 3 === 0 ? 1 : 0; // one run in three is a point higher on Voice
    const [v, i, d, s, c] = this.scores;
    const k = (score: number) => ({ score, evidence: "a quote", suggestion: "Add one concrete moment." });
    const value: EssayRun = { voice: k(Math.min(5, v + jitter)), insight: k(i), detail: k(d), structure: k(s), clarity: k(c), answersPrompt: this.answersPrompt, promptNote: this.answersPrompt ? "" : "It never says why this college." };
    return { value, calls: [{ value: null, model: "claude-opus-5-5", usage: { inputTokens: 2500, outputTokens: 600, cacheReadTokens: 1500 } }] };
  }
}

/** Student A from the spec, typed by hand. */
function studentAInputs(): AcademicInputs {
  const i = emptyInputs();
  i.testing = { type: "SAT", satSittings: [{ date: "Mar 2026", erw: 720, math: 730 }], actComposite: null };
  i.grades.unweightedGpa = 3.85;
  i.rigor = { offeredAdvanced: 12, offeredHonors: 0, takenAdvanced: 8, takenHonors: 0, selfRating: null, exams: [{ name: "AP Bio", kind: "AP", score: 5 }, { name: "AP World", kind: "AP", score: 5 }] };
  i.activities = [
    { kind: "HONOR", name: "State science award", type: "", level: "STATE", leadership: false },
    { kind: "ACTIVITY", name: "Robotics", type: "", level: "REGIONAL", leadership: true },
    { kind: "ACTIVITY", name: "Chess club", type: "", level: "SCHOOL", leadership: false },
  ];
  i.essays.personalStatement = "When I was nine I took apart the toaster. ".repeat(20);
  return i;
}

async function upload(userId: string, fileType: string, body: Buffer) {
  const { uploadId } = await createImportUpload(userId, { fileType, size: body.length, contentType: "application/pdf" });
  const row = await db.academicIndexUpload.findUniqueOrThrow({ where: { id: uploadId } });
  await storage.put(row.storageKey!, body, "application/pdf");
  return { uploadId, key: row.storageKey!, result: await completeImportUpload(userId, uploadId) };
}

describe("age screen", () => {
  it("blocks under-13s for good and stores only the outcome", async () => {
    const kid = await createUser("Kid");
    await expect(saveDraft(kid.id, { inputs: emptyInputs(), sources: {}, keepEssays: false })).rejects.toThrow(/date of birth/);
    await expect(submitAgeCheck(kid.id, "2015-01-01", NOW)).rejects.toThrow(AGE_BLOCKED_MESSAGE);
    // Trying again with another date doesn't work.
    await expect(submitAgeCheck(kid.id, "2000-01-01", NOW)).rejects.toThrow(AGE_BLOCKED_MESSAGE);
    const row = await db.academicIndexInputs.findUniqueOrThrow({ where: { userId: kid.id } });
    expect(row.ageCheck).toBe("BLOCKED");
    expect(JSON.stringify(row)).not.toContain("2015");
    await expect(submitAgeCheck((await createUser()).id, "2013-11-26", NOW)).rejects.toThrow(AGE_BLOCKED_MESSAGE); // 12, a day short
    expect(await submitAgeCheck((await createUser()).id, "2013-11-25", NOW)).toBe("PASSED"); // 13 today
    await expect(submitAgeCheck((await createUser()).id, "2013-02-30", NOW)).rejects.toThrow(/date of birth/);
  });
});

describe("PDF import and review", () => {
  it("reads PDFs, prefers the College Board SAT, needs every field confirmed, then deletes the PDFs", async () => {
    const ana = await student();
    const reader = new FakeReader({
      SAT_REPORT: extraction({ documentKind: "sat_report", satSittings: [{ date: "March 2026", erw: 700, math: 750, total: 1450, page: 2, confidence: "high" }, { date: "May 2026", erw: 720, math: 710, total: 1430, page: 3, confidence: "high" }] }),
      COMMON_APP: extraction({
        documentKind: "common_app",
        satSittings: [{ date: "March 2026", erw: 700, math: 700, total: 1400, page: 4, confidence: "high" }],
        gpa: { value: 3.9, scale: 4, weighting: "weighted", page: 5, confidence: "high" },
        courses: [
          { name: "AP Calculus BC", grade: "", level: "AP", page: 6, confidence: "high" },
          { name: "Honors English", grade: "", level: "HONORS", page: 6, confidence: "high" },
        ],
        apExams: [{ name: "AP Biology", score: 4, page: 4, confidence: "low" }],
        activities: [{ name: "Robotics Team", type: "Robotics", description: "Captain", leadership: true, suggestedLevel: "STATE", page: 8 }],
        honors: [{ name: "National Merit Commended", recognition: "national", page: 9, confidence: "high" }, { name: "Science fair", recognition: "state/regional", page: 9, confidence: "high" }],
        personalStatement: field("I took apart the toaster.\n\nThen I fixed it.", 11),
        supplements: [{ prompt: "Why us?", text: "Because of the labs.", wordLimit: 250, page: 14, confidence: "high" }],
      }),
    });

    const sat = await upload(ana.id, "SAT_REPORT", makePdf("SAT1450/RW700/Math750/March2026/Report"));
    const app = await upload(ana.id, "COMMON_APP", makePdf(""));
    expect(sat.result).toEqual({ ok: true });
    expect(queued).toHaveLength(2);

    for (const u of [sat, app]) expect(await runAcademicExtractJob({ uploadId: u.uploadId }, { reader, ocr: fakeOcr })).toBe("extracted");
    // The scanned page (no text layer) went through OCR; the other page didn't.
    expect(fakeOcr.calls).toBe(1);
    expect(reader.calls[0].pages[0].text).toContain("Math750");
    expect(reader.calls[1].pages[0].text).toContain("SCANNED PAGE");
    expect(await db.usageEvent.count({ where: { userId: ana.id, feature: "ACADEMIC_INDEX_IMPORT" } })).toBe(2);

    expect(await applyExtractions(ana.id)).toEqual({ applied: 2 });
    const s = await getAcademicIndex(ana.id);
    expect(s.inputs.testing.type).toBe("SAT");
    expect(s.inputs.testing.satSittings.map((x) => [x.erw, x.math])).toEqual([[700, 750], [720, 710]]); // College Board, both dates
    expect(s.sources["testing.satSittings.0"]).toMatchObject({ file: "SAT_REPORT", page: 2, confirmed: false, alternative: { fileLabel: "Common App", value: "SAT 1400 (self-reported)" } });
    expect(s.inputs.grades.unweightedGpa).toBeNull(); // only a weighted GPA was printed: Needed
    expect(s.inputs.rigor).toMatchObject({ takenAdvanced: 1, takenHonors: 1, offeredAdvanced: null });
    expect(s.inputs.activities.map((a) => [a.kind, a.level, a.leadership])).toEqual([["ACTIVITY", "STATE", true], ["HONOR", "NATIONAL", false], ["HONOR", "STATE", false]]);
    expect(s.sources["activities.0.level"].confidence).toBe("low"); // suggested by Coursebook: the student confirms
    expect(s.sources["activities.1.level"].confidence).toBe("high"); // Common App honors map directly
    expect(s.sources["activities.2.level"].confidence).toBe("low"); // "State/Regional" could be either
    expect(s.inputs.essays.personalStatement).toBe("I took apart the toaster.\n\nThen I fixed it.");
    expect(s.inputs.essays.supplements[0]).toEqual({ prompt: "Why us?", wordLimit: 250, text: "Because of the labs." });

    // The student fills what's Needed, but scoring waits until the review is confirmed.
    const inputs = { ...s.inputs, grades: { ...s.inputs.grades, unweightedGpa: 3.8 }, rigor: { ...s.inputs.rigor, offeredAdvanced: 10, offeredHonors: 4 } };
    const grader = new FakeGrader();
    await expect(scoreAcademicIndex(ana.id, { inputs, sources: s.sources, keepEssays: false }, { grader })).rejects.toThrow(/haven't been checked/);
    // Sending "confirmed" from the browser doesn't skip the review.
    const forged = Object.fromEntries(Object.entries(s.sources).map(([k, v]) => [k, { ...v, confirmed: true }]));
    await expect(scoreAcademicIndex(ana.id, { inputs, sources: forged, keepEssays: false }, { grader })).rejects.toThrow(/haven't been checked/);

    const low = Object.entries(s.sources).filter(([, v]) => v.confidence === "low").map(([k]) => k);
    expect(low.sort()).toEqual(["activities.0.level", "activities.2.level", "rigor.exams.0", "rigor.takenAdvanced", "rigor.takenHonors"]);
    await expect(confirmReview(ana.id, { inputs, sources: s.sources, keepEssays: false, ticked: low.slice(1) })).rejects.toThrow(/tick the 1 highlighted field/);
    expect(await confirmReview(ana.id, { inputs, sources: s.sources, keepEssays: false, ticked: low })).toEqual({ deleted: 2 });

    // The raw PDFs are gone; only the confirmed fields are kept.
    for (const u of [sat, app]) {
      expect(await storage.head(u.key)).toBeNull();
      expect(await db.academicIndexUpload.findUniqueOrThrow({ where: { id: u.uploadId } })).toMatchObject({ status: "CONFIRMED", storageKey: null, extracted: null });
    }
    const after = await getAcademicIndex(ana.id);
    expect(Object.values(after.sources).every((x) => x.confirmed)).toBe(true);
    expect(after.inputs.essays.personalStatement).toBe(""); // not kept: the student didn't choose to save essays

    const r = await scoreAcademicIndex(ana.id, { inputs, sources: after.sources, keepEssays: false }, { grader });
    expect(r.total).toBeGreaterThan(0);
  });

  it("limits files and size, refuses non-PDFs, and deletes unconfirmed PDFs after 24 hours", async () => {
    const ana = await student();
    await expect(createImportUpload(ana.id, { fileType: "COMMON_APP", size: 21 * 1024 * 1024, contentType: "application/pdf" })).rejects.toThrow(/20 MB/);
    await expect(createImportUpload(ana.id, { fileType: "RESUME", size: 10, contentType: "application/pdf" })).rejects.toThrow(/Choose which file/);
    const fake = await upload(ana.id, "TRANSCRIPT", Buffer.from("<html>not a pdf</html>"));
    expect(fake.result.ok).toBe(false);
    expect(await storage.head(fake.key)).toBeNull();

    const kept = [];
    for (let n = 0; n < 5; n++) kept.push(await upload(ana.id, "TRANSCRIPT", makePdf(`Transcript ${n}`)));
    await expect(createImportUpload(ana.id, { fileType: "TRANSCRIPT", size: 100, contentType: "application/pdf" })).rejects.toThrow(/Up to 5 files/);

    // A day later, never reviewed: the PDFs are deleted (the refused one already was).
    expect(await purgeExpiredUploads(new Date(Date.now() + 25 * 3600_000))).toBe(5);
    for (const u of kept) {
      expect(await storage.head(u.key)).toBeNull();
      expect((await db.academicIndexUpload.findUniqueOrThrow({ where: { id: u.uploadId } })).status).toBe("DELETED");
    }
    expect(await purgeExpiredUploads(new Date(Date.now() + 26 * 3600_000))).toBe(0);
  });

  it("refuses PDF import for 'SAT only, no AI' accounts, who can still score by hand (essays pending)", async () => {
    const [siteAdmin, admin] = await Promise.all([createUser("Site"), createUser("Admin")]);
    await db.user.update({ where: { id: siteAdmin.id }, data: { role: "ADMIN" } });
    const program = await createProgram(admin.id, "The 1600 Project");
    const ana = await student();
    await setAccessRule(siteAdmin.id, { email: ana.email, programId: program.id, mode: "SAT_ONLY" });
    await expect(createImportUpload(ana.id, { fileType: "COMMON_APP", size: 100, contentType: "application/pdf" })).rejects.toThrow(/AI features aren't available/);
    const grader = new FakeGrader();
    const { resultId } = await scoreAcademicIndex(ana.id, { inputs: studentAInputs(), sources: {}, keepEssays: true }, { grader });
    const r = await getResult(ana.id, resultId);
    expect(grader.calls).toBe(0);
    expect(r.estimateType).toBe("partial");
    expect(r.detail.essayNote).toMatch(/isn't available on your account/);
  });
});

describe("scoring", () => {
  it("scores Student A at 189 Excellent with a 3-run median, then reuses the grade for an unchanged essay", async () => {
    const ana = await student();
    const grader = new FakeGrader();
    const { resultId, total, tier } = await scoreAcademicIndex(ana.id, { inputs: studentAInputs(), sources: {}, keepEssays: true }, { grader });
    expect([total, tier]).toEqual([189, "Excellent"]);
    expect(grader.calls).toBe(3);
    const r = await getResult(ana.id, resultId);
    expect(r).toMatchObject({ formulaVersion: "v1", estimateType: "full", total: 189, tier: "Excellent", essayPoints: 20 });
    expect(r.testPoints).toBeCloseTo(63.4375, 6);
    expect(r.essays.personalStatement!.criteria).toEqual({ voice: 4, insight: 4, detail: 3, structure: 4, clarity: 5 }); // the odd run (voice 5) is outvoted
    expect(r.essays.personalStatement!.feedback.detail).toEqual({ evidence: "a quote", suggestion: "Add one concrete moment." });
    expect(r.detail.levers[0]).toMatchObject({ component: "rigor" });
    expect(r.detail.labels).toEqual([]);
    expect(await db.usageEvent.count({ where: { userId: ana.id, feature: "ESSAY_GRADING" } })).toBe(3);
    // Kept, because the student chose to save their essays.
    expect((await getAcademicIndex(ana.id)).inputs.essays.personalStatement).toContain("toaster");

    // Same essay again: no new grading, no new request counted.
    await scoreAcademicIndex(ana.id, { inputs: studentAInputs(), sources: {}, keepEssays: true }, { grader });
    expect(grader.calls).toBe(3);
    expect(await essayRequestsToday(ana.id)).toBe(1);
    expect((await getAcademicIndex(ana.id)).results).toHaveLength(2);
  });

  it("applies the word limit and prompt rules, combines supplements, and labels a test-optional estimate", async () => {
    const ana = await student();
    const i = studentAInputs();
    i.testing = { type: "NONE", satSittings: [], actComposite: null };
    i.essays.personalStatement = Array.from({ length: 700 }, () => "word").join(" ");
    i.essays.supplements = [{ prompt: "Why us?", wordLimit: 250, text: "I like your campus." }];
    const { resultId } = await scoreAcademicIndex(ana.id, { inputs: i, sources: {}, keepEssays: false }, { grader: new FakeGrader([4, 4, 3, 4, 5], false) });
    const r = await getResult(ana.id, resultId);
    expect(r.essays.personalStatement!.criteria.clarity).toBe(4);
    expect(r.essays.personalStatement!.warnings[0]).toMatch(/700 words is over the 650-word limit/);
    expect(r.essays.supplements[0].criteria.insight).toBe(2);
    expect(r.essays.supplements[0].warnings[0]).toMatch(/never says why this college/);
    // PS 19, supplement 18 → 0.7 × 19 + 0.3 × 18
    expect(r.essayPoints).toBeCloseTo(18.7, 6);
    expect(r.estimateType).toBe("test_optional");
    expect(r.detail.labels).toEqual(["Test-optional estimate"]);
    expect(r.testPoints).toBeNull();
    // Essays weren't kept, and the result has feedback but never the essay text.
    expect((await getAcademicIndex(ana.id)).inputs.essays.personalStatement).toBe("");
    expect(JSON.stringify(r.essayFeedback)).not.toContain("word word word");
  });

  it("allows 5 essay scorings a day, and reports grading failures without saving a result", async () => {
    const ana = await student();
    const grader = new FakeGrader();
    for (let n = 0; n < 5; n++) {
      const i = studentAInputs();
      i.essays.personalStatement += ` Revision ${n}.`;
      await scoreAcademicIndex(ana.id, { inputs: i, sources: {}, keepEssays: false }, { grader });
    }
    const i = studentAInputs();
    i.essays.personalStatement += " Revision 6.";
    await expect(scoreAcademicIndex(ana.id, { inputs: i, sources: {}, keepEssays: false }, { grader })).rejects.toThrow(/5 times a day/);
    // A day later it works again.
    const tomorrow = new Date(Date.now() + 25 * 3600_000);
    expect(await essayRequestsToday(ana.id, tomorrow)).toBe(0);

    const ben = await student("Ben");
    grader.fail = new AiError("retryable", "Claude is busy right now. Please try again in a minute.");
    await expect(scoreAcademicIndex(ben.id, { inputs: studentAInputs(), sources: {}, keepEssays: false }, { grader })).rejects.toThrow(/Claude is busy/);
    expect(await db.academicIndexResult.count({ where: { userId: ben.id } })).toBe(0);
  });

  it("refuses to score until everything needed is filled in", async () => {
    const ana = await student();
    const i = studentAInputs();
    i.grades.unweightedGpa = 4.2;
    await expect(scoreAcademicIndex(ana.id, { inputs: i, sources: {}, keepEssays: false }, { grader: null })).rejects.toThrow("Enter your unweighted GPA (0.00–4.00)");
    const { needed } = await saveDraft(ana.id, { inputs: emptyInputs(), sources: {}, keepEssays: false });
    expect(needed.length).toBeGreaterThan(0);
    // No grader on the server: a partial estimate.
    const { resultId } = await scoreAcademicIndex(ana.id, { inputs: studentAInputs(), sources: {}, keepEssays: false }, { grader: null });
    const r = await getResult(ana.id, resultId);
    expect(r.estimateType).toBe("partial");
    expect(r.detail.labels).toEqual(["Partial estimate — essays pending"]);
  });
});

describe("privacy and sharing", () => {
  it("is private by default; staff see it only for a class the student shared it with, without essays", async () => {
    const [teacher, otherTeacher] = await Promise.all([createUser("Teacher"), createUser("Other")]);
    const cls = await createClass(teacher.id, "SAT Fall");
    const other = await createClass(otherTeacher.id, "Other class");
    const ana = await student();
    await joinClass(ana.id, cls.joinCode);
    const { resultId } = await scoreAcademicIndex(ana.id, { inputs: studentAInputs(), sources: {}, keepEssays: true }, { grader: new FakeGrader() });

    expect(await sharedIndexForStaff(teacher.id, cls.id, ana.id)).toBeNull();
    await expect(getResult(teacher.id, resultId)).rejects.toThrow(NotFoundError);

    // Sharing with a class the student isn't in is ignored.
    expect(await setShares(ana.id, [cls.id, other.id])).toEqual({ shared: 1 });
    const seen = await sharedIndexForStaff(teacher.id, cls.id, ana.id);
    expect(seen!.latest).toMatchObject({ total: 189, tier: "Excellent" });
    expect(JSON.stringify(seen)).not.toContain("toaster");
    expect(JSON.stringify(seen)).not.toContain("a quote");
    await expect(sharedIndexForStaff(otherTeacher.id, cls.id, ana.id)).rejects.toThrow();

    await setShares(ana.id, []);
    expect(await sharedIndexForStaff(teacher.id, cls.id, ana.id)).toBeNull();
  });

  it("keeps errors readable", () => {
    expect(new AcademicIndexError("x", 429).status).toBe(429);
  });
});
