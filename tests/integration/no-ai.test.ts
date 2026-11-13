import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { AiError } from "@/server/ai/writer";
import type { AssistantModel } from "@/server/ai/assistant";
import { askTutor, TutorError } from "@/server/tutor/chat";
import { gradeAnswer, submitAttempt, StudyError } from "@/server/study";
import { assignQuestions, answerQuestion, createClass, joinClass } from "@/server/classes";
import { regenerateLesson, getLessonView, GenerationError } from "@/server/generation/lessons";
import { runLessonJob } from "@/server/generation/run";
import { createMissingAssessments } from "@/server/generation/assessments";
import { createUpload, getCourse } from "@/server/courses";
import { createWorksheetUpload, WorksheetError } from "@/server/worksheets";
import { draftQuestions, generateSummary } from "@/server/assistant";
import { assertAiBudget, assertCanGenerate, ensureAiBudget, NoAiError } from "@/server/limits";
import { applySignupMentee, createProgram, updateProgram } from "@/server/programs";
import { isNoAi, NO_AI_MESSAGE, setAccessRule } from "@/server/program-access";
import { syncOwnerRole } from "@/server/roles";
import * as bank from "@/server/bank";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeEmbedder, FakeGrader, FakeTutor, FakeWriter, sampleDraft } from "../helpers/fake-claude";

/**
 * "SAT only, no AI" accounts (Admin → Program access): every way into Claude is
 * refused (tutor, grading, generation, uploads, worksheets, the assistant), and
 * the AI stand-ins below are never called. They can still practise with
 * published question-bank sets and read their class courses.
 */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
const queued = vi.hoisted(() => [] as unknown[]);
vi.mock("@/server/queue", () => ({ enqueueGeneration: async (jobs: unknown[]) => void queued.push(...jobs), enqueueBookProcessing: async () => ({ id: "job" }), enqueueWorksheet: async () => ({ id: "job" }) }));

/** An assistant that records any call: none may happen for a no-AI account. */
function spyAssistant() {
  const calls: string[] = [];
  const ai = {
    kind: "claude",
    structured: async () => {
      calls.push("structured");
      throw new Error("Claude must not be called");
    },
    withTools: async () => {
      calls.push("withTools");
      throw new Error("Claude must not be called");
    },
  } as unknown as AssistantModel;
  return { ai, calls };
}

const savedOwner = process.env.OWNER_EMAIL;
afterAll(() => {
  process.env.OWNER_EMAIL = savedOwner;
});

beforeEach(async () => {
  await resetDb();
  queued.length = 0;
});

/** The 1600 Project with one class, a no-AI student in it (with a class course copy) and an ordinary student. */
async function fixture() {
  const [siteAdmin, admin, student, ordinary] = await Promise.all(["Site Admin", "Program Admin", "No-AI Student", "Ordinary Student"].map((n) => createUser(n)));
  await db.user.update({ where: { id: siteAdmin.id }, data: { role: "ADMIN" } });
  const program = await createProgram(admin.id, "The 1600 Project");
  const cls = await createClass(admin.id, "SAT Fall", program.id);
  await setAccessRule(siteAdmin.id, { email: student.email, programId: program.id, mode: "SAT_ONLY" });
  await joinClass(student.id, cls.joinCode);
  await joinClass(ordinary.id, cls.joinCode);

  // The student's copy of a class course: already generated, with a written and a multiple-choice question.
  const book = await db.book.create({ data: { userId: student.id, originalFilename: "sat.pdf", storageKey: `k-${Math.random()}`, sizeBytes: BigInt(1), status: "READY", pageCount: 4 } });
  await db.page.createMany({ data: [1, 2, 3, 4].map((n) => ({ bookId: book.id, pageNumber: n, text: `Page ${n}. Slope is rise over run. `.repeat(6), charCount: 100, mathScore: 0, width: 612, height: 792 })) });
  const classCourse = await db.classCourse.create({ data: { classId: cls.id, title: "SAT Math" } });
  const course = await db.course.create({ data: { userId: student.id, bookId: book.id, title: "SAT Math", status: "ACTIVE", settings: DEFAULT_SETTINGS, classCourseId: classCourse.id } });
  const unit = await db.unit.create({ data: { courseId: course.id, order: 0, title: "Lines", lessons: { create: [{ courseId: course.id, order: 0, title: "Slope", pageStart: 1, pageEnd: 4 }] } }, include: { lessons: true } });
  const lesson = unit.lessons[0];
  const draft = sampleDraft(1, 4);
  await db.lesson.update({ where: { id: lesson.id }, data: { status: "READY", generatedAt: new Date(), model: "demo", content: { explanation: draft.explanation, objectives: draft.objectives, workedExamples: draft.workedExamples, keyTerms: draft.keyTerms } } });
  const written = await db.question.create({ data: { courseId: course.id, lessonId: lesson.id, scope: "LESSON", order: 0, type: "SHORT_ANSWER", prompt: "Explain what a slope of 2 means.", answer: "y goes up 2 for every 1 in x", explanation: "Rise over run.", choices: [], topic: "Slope", pageRefs: [1] } });
  const mcq = await db.question.create({ data: { courseId: course.id, lessonId: lesson.id, scope: "LESSON", order: 1, type: "MULTIPLE_CHOICE", prompt: "Slope of y = 2x + 1?", answer: "2", explanation: "The x coefficient.", choices: ["1", "2", "3", "4"], correctChoice: 1, topic: "Slope", pageRefs: [1] } });
  return { siteAdmin, admin, student, ordinary, program, cls, course, lesson, written, mcq };
}

describe("SAT only, no AI", () => {
  it("is refused at the central gate in front of every Claude call", async () => {
    const f = await fixture();
    expect(await isNoAi(f.student.id)).toBe(true);
    expect(await isNoAi(f.ordinary.id)).toBe(false);
    await expect(assertAiBudget(f.student.id)).rejects.toBeInstanceOf(NoAiError);
    await expect(assertCanGenerate(f.student.id, f.course.id, [f.lesson.id])).rejects.toBeInstanceOf(NoAiError);
    await expect(ensureAiBudget(f.student.id)).rejects.toMatchObject({ kind: "limit", userMessage: NO_AI_MESSAGE });
    await expect(assertAiBudget(f.ordinary.id)).resolves.toBeUndefined();
  });

  it("can't use the tutor", async () => {
    const f = await fixture();
    const tutor = new FakeTutor();
    const err = await askTutor(f.student.id, { courseId: f.course.id, question: "What is slope?" }, { tutor, embedder: new FakeEmbedder() }, () => {}, new AbortController().signal).catch((e) => e);
    expect(err).toBeInstanceOf(TutorError);
    expect(err).toMatchObject({ status: 403, message: NO_AI_MESSAGE });
    expect(tutor.calls).toHaveLength(0);
  });

  it("gets no AI grading: written answers are refused in practice, saved unchecked in tests, left for the tutor in assignments", async () => {
    const f = await fixture();
    const grader = new FakeGrader();
    // Practice: a written answer that doesn't match isn't sent to Claude.
    await expect(submitAttempt(f.student.id, f.written.id, { response: "it is steep" }, { grader })).rejects.toBeInstanceOf(StudyError);
    // Multiple choice is still checked (no AI needed).
    expect(await submitAttempt(f.student.id, f.mcq.id, { choice: 1 }, { grader })).toMatchObject({ correct: true, gradedBy: "LOCAL" });
    // Tests: saved as not checked.
    const q = await db.question.findUniqueOrThrow({ where: { id: f.written.id }, include: { lesson: { select: { pageStart: true, pageEnd: true } }, course: { select: { bookId: true } } } });
    const g = await gradeAnswer(f.student.id, q, { response: "it is steep" }, { grader }, { recordUnchecked: true });
    expect(g).toMatchObject({ gradedBy: "LOCAL", result: { correct: false, score: 0 } });
    expect(g.result.feedback).toMatch(/Not checked/);

    // Class assignment: a written answer is saved for the tutor (gradedBy NONE), never sent to Claude.
    const ws = await db.worksheet.create({ data: { ownerId: f.admin.id, title: "Week 3", fileKey: "ws", sizeBytes: BigInt(1), status: "READY", items: { create: [{ order: 0, label: "1", type: "SHORT_ANSWER", prompt: "Explain slope.", answer: "rise over run", explanation: "", topic: "Slope", section: "MATH", domain: "algebra", skill: "Linear equations in one variable", tagsConfirmed: true }] } }, include: { items: true } });
    const [a] = await assignQuestions(f.admin.id, { classIds: [f.cls.id], worksheetId: ws.id, itemIds: [], title: "Week 3" });
    const answered = await answerQuestion(f.student.id, a.id, ws.items[0].id, { response: "it goes up" }, { grader });
    expect(JSON.stringify(answered)).toMatch(/couldn't be checked automatically|NONE/);

    expect(grader.calls).toHaveLength(0);
    // The same question for an ordinary student in the class (on their own copy) does reach the grader: the spy works.
    const theirs = await db.question.create({ data: { courseId: f.course.id, lessonId: f.lesson.id, scope: "LESSON", order: 2, type: "SHORT_ANSWER", prompt: "Explain slope.", answer: "rise over run", explanation: "", choices: [], topic: "Slope", pageRefs: [1] } });
    const q2 = await db.question.findUniqueOrThrow({ where: { id: theirs.id }, include: { lesson: { select: { pageStart: true, pageEnd: true } }, course: { select: { bookId: true } } } });
    await gradeAnswer(f.ordinary.id, q2, { response: "it is steep" }, { grader });
    expect(grader.calls).toHaveLength(1);
  });

  it("can't generate or regenerate lessons, questions or tests", async () => {
    const f = await fixture();
    const writer = new FakeWriter();
    await expect(regenerateLesson(f.student.id, f.lesson.id, { mode: "lesson" })).rejects.toBeInstanceOf(GenerationError);
    await expect(regenerateLesson(f.student.id, f.lesson.id, { mode: "questions" })).rejects.toThrow(NO_AI_MESSAGE);
    await expect(createMissingAssessments(f.student.id, f.course.id)).rejects.toBeInstanceOf(NoAiError);
    expect(queued).toHaveLength(0);
    // Even a job already in the queue stops before calling Claude (e.g. the rule was added after it was queued).
    await expect(runLessonJob({ lessonId: f.lesson.id, force: true }, { writer, model: "claude-sonnet-5-5", effort: "medium" })).rejects.toBeInstanceOf(AiError);
    expect(writer.lessonCalls).toHaveLength(0);
    expect(writer.questionCalls).toHaveLength(0);
  });

  it("can't upload textbooks or slides, or worksheets to be read", async () => {
    const f = await fixture();
    await expect(createUpload(f.student.id, { filename: "book.pdf", size: 1000, contentType: "application/pdf", rightsConfirmed: true })).rejects.toThrow(/only/);
    await expect(createWorksheetUpload(f.student.id, { filename: "ws.pdf", size: 1000, contentType: "application/pdf", rightsConfirmed: true })).rejects.toBeInstanceOf(WorksheetError);
  });

  it("a no-AI tutor can't use the assistant (drafting questions or summaries)", async () => {
    const f = await fixture();
    const tutor = await createUser("No-AI Tutor");
    await db.classStaff.create({ data: { classId: f.cls.id, userId: tutor.id, role: "TEACHER" } });
    await setAccessRule(f.siteAdmin.id, { email: tutor.email, programId: f.program.id, mode: "SAT_ONLY" });
    const { ai, calls } = spyAssistant();
    await expect(draftQuestions(tutor.id, f.cls.id, { domain: "algebra", difficulty: "EASY", count: 3 }, { ai })).rejects.toThrow(NO_AI_MESSAGE);
    await expect(generateSummary(tutor.id, f.cls.id, {}, { ai })).rejects.toThrow(NO_AI_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  it("can still practise with published question-bank sets and read class courses", async () => {
    const f = await fixture();
    const owner = await createUser("Owner");
    process.env.OWNER_EMAIL = owner.email;
    await syncOwnerRole();
    const q = await bank.createQuestion(owner.id, { external_id: "W3-01", section: "math", skill: "Linear equations in one variable", difficulty: 1, type: "mcq", stem: "If 2(x − 4) = −2, what is x?", choice_a: "1", choice_b: "−1", choice_c: "−5", choice_d: "3", answer: "D", explanation: "Divide by 2, then add 4." }, { publish: true });
    const set = await bank.createSet(owner.id, { title: "Week 3", questionIds: [q.id], visibility: "public" });
    await bank.setSetStatus(owner.id, set.id, "published");
    const { sessionId } = await bank.startPractice(f.student.id, set.id);
    expect(await bank.answerPractice(f.student.id, sessionId, q.id, "D", 8)).toMatchObject({ correct: true });

    expect((await getCourse(f.student.id, f.course.id)).id).toBe(f.course.id);
    const view = await getLessonView(f.student.id, f.course.id, f.lesson.id);
    expect(view.content?.explanation).toBeTruthy();
    expect(view.questions).toHaveLength(2);
  });
});

describe("turning it on", () => {
  it("never limits site admins or the program's own admin", async () => {
    const f = await fixture();
    await expect(setAccessRule(f.siteAdmin.id, { email: f.siteAdmin.email, programId: f.program.id, mode: "SAT_ONLY" })).rejects.toThrow(/Site admins/);
    await expect(setAccessRule(f.siteAdmin.id, { email: f.admin.email, programId: f.program.id, mode: "SAT_ONLY" })).rejects.toThrow(/admin of The 1600 Project/);
  });

  it("the program default: students who join are SAT only, no AI; the change and each rule are in the audit log", async () => {
    const f = await fixture();
    await updateProgram(f.admin.id, f.program.id, { newStudentsNoAi: true });
    const newcomer = await createUser("Newcomer");
    await joinClass(newcomer.id, f.cls.joinCode);
    expect(await isNoAi(newcomer.id)).toBe(true);
    // Someone who already had a rule keeps theirs; the program's admin is never limited.
    await setAccessRule(f.siteAdmin.id, { email: "kept@example.com", programId: f.program.id, mode: "ONLY" });
    const kept = await db.user.create({ data: { id: `kept-${Date.now()}`, name: "Kept", email: "kept@example.com", emailVerified: true } });
    await joinClass(kept.id, f.cls.joinCode);
    expect(await isNoAi(kept.id)).toBe(false);
    const log = await db.auditLog.findMany({ where: { programId: f.program.id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.summary)).toEqual(expect.arrayContaining(["New students who join are now SAT only, no AI", expect.stringMatching(/Set .* only, no AI \(joined a class/)]));
    // Without the setting, joining changes nothing.
    await updateProgram(f.admin.id, f.program.id, { newStudentsNoAi: false });
    const later = await createUser("Later");
    await joinClass(later.id, f.cls.joinCode);
    expect(await isNoAi(later.id)).toBe(false);
  });

  it("signing up as a mentee becomes the rule once the email is verified, for a public program only", async () => {
    const f = await fixture();
    await db.program.update({ where: { id: f.program.id }, data: { slug: "1600", isPublic: true } });
    const mentee = await db.user.create({ data: { id: `m-${Date.now()}`, name: "Mentee", email: "mentee@example.com", emailVerified: false, signupProgramId: f.program.id } });
    expect(await applySignupMentee(mentee.id)).toBe(false); // not verified yet
    await db.user.update({ where: { id: mentee.id }, data: { emailVerified: true } });
    expect(await applySignupMentee(mentee.id)).toBe(true);
    expect(await isNoAi(mentee.id)).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: mentee.id } })).signupProgramId).toBeNull();

    const hidden = await createProgram(f.admin.id, "Private program");
    const other = await db.user.create({ data: { id: `o-${Date.now()}`, name: "Other", email: "other@example.com", emailVerified: true, signupProgramId: hidden.id } });
    expect(await applySignupMentee(other.id)).toBe(false);
    expect(await isNoAi(other.id)).toBe(false);
  });
});
