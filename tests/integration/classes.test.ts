import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/server/db";
import { storage, storageKeys } from "@/server/storage";
import { NotFoundError } from "@/server/courses";
import { getUsage } from "@/server/limits";
import {
  answerQuestion,
  assignLessons,
  assignmentReport,
  assignQuestions,
  ClassError,
  classProgress,
  createClass,
  getClassForTeacher,
  getQuestionAssignment,
  handIn,
  inviteStudents,
  joinClass,
  myClasses,
  removeStudent,
  skillsReport,
  startLessons,
  startQuestions,
} from "@/server/classes";
import { runWorksheetJob } from "@/server/worksheets";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import { createUser, resetDb } from "../helpers/db";
import { FakeGrader, FakeWriter } from "../helpers/fake-claude";

vi.mock("@/server/queue", async (orig) => ({
  ...(await orig<typeof import("@/server/queue")>()),
  enqueueGeneration: async () => {},
  enqueueBookProcessing: async () => ({ id: "job" }),
}));

beforeEach(resetDb);

const content = (title: string) => ({ objectives: [`Explain ${title}.`], explanation: `About ${title} (p. 1).`, workedExamples: [], keyTerms: [] });

/** A teacher with a generated course: 2 units, 3 lessons (with practice questions and flashcards). */
async function teacherWithCourse() {
  const teacher = await createUser("Ms Rivera");
  const book = await db.book.create({ data: { userId: teacher.id, originalFilename: "algebra.pdf", storageKey: storageKeys.bookOriginal(teacher.id, "b1"), sizeBytes: BigInt(1000), status: "READY", pageCount: 6 } });
  await storage.put(book.storageKey, Buffer.from("%PDF-1.4 algebra"), "application/pdf");
  await db.page.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ bookId: book.id, pageNumber: i + 1, text: `Page ${i + 1} about lines.`, charCount: 20, width: 612, height: 792 })) });
  const course = await db.course.create({ data: { userId: teacher.id, bookId: book.id, title: "Algebra 1", status: "ACTIVE", settings: DEFAULT_SETTINGS } });
  const mk = (order: number, title: string, lessons: string[]) =>
    db.unit.create({
      data: { courseId: course.id, order, title, lessons: { create: lessons.map((t, i) => ({ courseId: course.id, order: i, title: t, pageStart: order * 3 + i + 1, pageEnd: order * 3 + i + 1, status: "READY" as const, content: content(t), generatedAt: new Date() })) } },
      include: { lessons: { orderBy: { order: "asc" } } },
    });
  const u1 = await mk(0, "Linear equations", ["Solving one-step equations", "Two-step equations"]);
  const u2 = await mk(1, "Graphs", ["Slope"]);
  const lessons = [...u1.lessons, ...u2.lessons];
  for (const l of lessons) {
    await db.question.create({ data: { courseId: course.id, lessonId: l.id, scope: "LESSON", type: "SHORT_ANSWER", order: 0, prompt: `About ${l.title}?`, answer: "x", explanation: "", topic: l.title } });
    await db.flashcard.create({ data: { courseId: course.id, lessonId: l.id, order: 0, front: l.title, back: "card" } });
  }
  return { teacher, course, lessons };
}

/** A small worksheet PDF, read by the (fake) Claude. */
async function readyWorksheet(ownerId: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["1. If 3x + 5 = 20, what is x?  2. Which word best fits?", "3. Explain what a slope of 2 means."]) doc.addPage([612, 792]).drawText(text, { x: 50, y: 700, size: 12, font });
  const ws = await db.worksheet.create({ data: { ownerId, title: "Week 3 homework", fileKey: storageKeys.worksheet(ownerId, `w-${Date.now()}`), sizeBytes: BigInt(1), status: "READING" } });
  await storage.put(ws.fileKey, Buffer.from(await doc.save()), "application/pdf");
  const writer = new FakeWriter();
  expect(await runWorksheetJob({ worksheetId: ws.id }, { writer })).toBe("read");
  expect(writer.worksheetCalls[0].pages).toHaveLength(2);
  expect(writer.worksheetCalls[0].pages[0].png?.subarray(1, 4).toString()).toBe("PNG"); // Claude sees each page as an image
  return db.worksheet.findUniqueOrThrow({ where: { id: ws.id }, include: { items: { orderBy: { order: "asc" } } } });
}

async function classWithStudents(teacherId: string, names = ["Ana", "Ben"]) {
  const c = await createClass(teacherId, "Period 2 Algebra");
  const students = [];
  for (const n of names) {
    const s = await createUser(n);
    await joinClass(s.id, c.joinCode.toLowerCase().split("").join(" ")); // codes are forgiving about case and spaces
    students.push(s);
  }
  return { c, students };
}

describe("classes", () => {
  it("lets students join with the code; invites email a link; teachers can remove students", async () => {
    const teacher = await createUser("Ms Rivera");
    const { c, students } = await classWithStudents(teacher.id);
    await expect(joinClass(students[0].id, "NOPE123")).rejects.toThrow("No class has that code");
    await expect(joinClass(teacher.id, c.joinCode)).rejects.toThrow("You teach this class");
    const res = await inviteStudents(teacher.id, c.id, `new@school.org, ${students[0].email}; not-an-email`);
    expect(res).toEqual({ invited: ["new@school.org"], alreadyIn: [students[0].email.toLowerCase()], invalid: ["not-an-email"] });
    const view = await getClassForTeacher(teacher.id, c.id);
    expect(view.members.map((m) => m.user.name)).toEqual(["Ana", "Ben"]);
    expect(view.invites.map((i) => i.email)).toEqual(["new@school.org"]);
    expect(view.joinUrl).toMatch(new RegExp(`/join/${c.joinCode}$`));
    await removeStudent(teacher.id, c.id, students[1].id);
    expect((await getClassForTeacher(teacher.id, c.id)).members).toHaveLength(1);
    // Only the teacher sees the class.
    await expect(getClassForTeacher(students[0].id, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("assigns lessons: each student gets their own copy on starting, and progress shows in the grid", async () => {
    const { teacher, course, lessons } = await teacherWithCourse();
    const { c, students } = await classWithStudents(teacher.id);
    const a = await assignLessons(teacher.id, c.id, { courseId: course.id, lessonIds: [lessons[1].id, lessons[0].id], dueAt: new Date(Date.now() + 86_400_000) });
    expect(a.title).toBe("Solving one-step equations + 1 more");
    expect(a.lessonIds).toEqual([lessons[0].id, lessons[1].id]); // course order
    await expect(assignLessons(students[0].id, c.id, { courseId: course.id, lessonIds: [] })).rejects.toBeInstanceOf(NotFoundError);

    const ana = students[0];
    const start = await startLessons(ana.id, a.id);
    const copy = await db.course.findUniqueOrThrow({ where: { id: start.courseId }, include: { lessons: true, book: true, flashcards: true } });
    expect(copy).toMatchObject({ userId: ana.id, title: "Algebra 1", status: "ACTIVE" });
    expect(copy.lessons.find((l) => l.id === start.lessonId)!.sourceLessonId).toBe(lessons[0].id);
    expect(copy.flashcards).toHaveLength(3);
    expect(copy.book.storageKey).toMatch(/^classes\//); // a shared snapshot, not the teacher's file
    expect((await startLessons(ana.id, a.id)).courseId).toBe(copy.id); // one copy per student
    // Class copies don't count against the student's plan.
    expect((await getUsage(ana.id)).usage.books).toBe(0);

    const copied = (sourceId: string) => copy.lessons.find((l) => l.sourceLessonId === sourceId)!;
    await db.lessonProgress.create({ data: { userId: ana.id, courseId: copy.id, lessonId: copied(lessons[0].id).id, completedAt: new Date() } });
    let grid = await classProgress(teacher.id, c.id);
    expect(grid.cells[`${ana.id}:${a.id}`]).toMatchObject({ status: "in_progress", done: 1, total: 2 });
    expect(grid.cells[`${students[1].id}:${a.id}`]).toMatchObject({ status: "not_started", done: 0 });
    await db.lessonProgress.create({ data: { userId: ana.id, courseId: copy.id, lessonId: copied(lessons[1].id).id, completedAt: new Date() } });
    grid = await classProgress(teacher.id, c.id);
    expect(grid.cells[`${ana.id}:${a.id}`]).toMatchObject({ status: "done", done: 2, late: false });
    expect(grid.summary).toEqual([{ id: a.id, done: 1, average: null }]);
    expect((await myClasses(ana.id))[0].assignments[0].cell.status).toBe("done");

    // Non-members can't open it.
    const stranger = await createUser("Stranger");
    await expect(startLessons(stranger.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reads a worksheet into questions, fixing what can't be used", async () => {
    const teacher = await createUser("Ms Rivera");
    const ws = await readyWorksheet(teacher.id);
    expect(ws).toMatchObject({ status: "READY", pageCount: 2, hasAnswerKey: true });
    expect(ws.items.map((i) => [i.label, i.type, i.answerSource])).toEqual([
      ["1", "MULTIPLE_CHOICE", "WORKSHEET"],
      ["2", "SHORT_ANSWER", "WORKSHEET"], // only one option: checked as a written answer instead
      ["3", "SHORT_ANSWER", "CLAUDE"], // Claude worked it out: the teacher should check it
    ]);
    expect(ws.items[1].pageRefs).toEqual([1]); // page 99 doesn't exist
    const usage = await db.usageEvent.findMany({ where: { userId: teacher.id } });
    expect(usage.map((u) => u.feature)).toEqual(["WORKSHEET"]);
  });

  it("assigns worksheet questions to several classes, checks answers, and reports by question and skill", async () => {
    const { teacher, course } = await teacherWithCourse();
    const ws = await readyWorksheet(teacher.id);
    const { c, students } = await classWithStudents(teacher.id);
    const other = await createClass(teacher.id, "Period 5 Algebra");
    const [a, a5] = await assignQuestions(teacher.id, { classIds: [c.id, other.id], worksheetId: ws.id, itemIds: [ws.items[2].id, ws.items[0].id], title: "Homework 3, Q1 and Q3", courseId: course.id });
    expect(a.itemIds).toEqual([ws.items[0].id, ws.items[2].id]);
    expect(a5.classId).toBe(other.id);
    expect(a.classCourseId).not.toBeNull(); // filed under the course

    const [ana, ben] = students;
    const grader = new FakeGrader();
    grader.next = { verdict: "correct", score: 1, feedback: "Yes: it rises 2 for every 1 across." };
    // Before answering, the answer key isn't sent.
    const before = await getQuestionAssignment(ana.id, a.id);
    expect(before.questions.map((q) => q.answer)).toEqual([null, null]);
    expect(before.questions[0]).toMatchObject({ type: "MULTIPLE_CHOICE", choices: ["3", "5", "15", "25"] });

    expect(await answerQuestion(ana.id, a.id, ws.items[0].id, { choice: 1 }, { grader })).toMatchObject({ correct: true, verdict: "CORRECT" });
    expect(await answerQuestion(ana.id, a.id, ws.items[2].id, { response: "It goes up by two" }, { grader })).toMatchObject({ correct: true, gradedBy: "CLAUDE" });
    expect(grader.calls[0]).toMatchObject({ type: "SHORT_ANSWER", answer: "y goes up by 2 when x goes up by 1." });
    await answerQuestion(ben.id, a.id, ws.items[0].id, { choice: 2 }, { grader });
    await answerQuestion(ben.id, a.id, ws.items[0].id, { choice: 3 }, { grader }); // the latest answer counts
    await expect(answerQuestion(ben.id, a.id, ws.items[1].id, { response: "x" }, { grader })).rejects.toBeInstanceOf(NotFoundError); // not in this set

    const after = await getQuestionAssignment(ana.id, a.id);
    expect(after).toMatchObject({ answered: 2, score: 2, reveal: true });
    expect(after.questions[0].answer).toMatchObject({ correctChoice: 1 });

    const report = await assignmentReport(teacher.id, a.id);
    expect(report.students.map((s) => [s.student.name, s.status, s.done, s.score])).toEqual([
      ["Ana", "done", 2, 1],
      ["Ben", "in_progress", 1, 0],
    ]);
    expect(report.questions[0]).toMatchObject({ label: "1", answered: 2, correctRate: 0.5, choiceCounts: [0, 1, 0, 1] });
    expect(report.questions[1]).toMatchObject({ label: "3", answered: 1, answerSource: "CLAUDE" });
    const skills = await skillsReport(teacher.id, c.id);
    expect(skills).toEqual([{ topic: "Linear equations", answers: 3, accuracy: 2 / 3, struggling: [] }]);
    await expect(assignmentReport(ana.id, a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("runs timed sets: start the clock, results hidden until handed in, locked when time is up", async () => {
    const teacher = await createUser("Ms Rivera");
    const ws = await readyWorksheet(teacher.id);
    const { c, students } = await classWithStudents(teacher.id, ["Ana"]);
    const [a] = await assignQuestions(teacher.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [], title: "Practice section", timeLimitMin: 25 });
    const ana = students[0];
    const grader = new FakeGrader();
    await expect(answerQuestion(ana.id, a.id, ws.items[0].id, { choice: 1 }, { grader })).rejects.toThrow("Start the timer first");
    await startQuestions(ana.id, a.id);
    expect(await answerQuestion(ana.id, a.id, ws.items[0].id, { choice: 0 }, { grader })).toEqual({ saved: true }); // no result yet
    let view = await getQuestionAssignment(ana.id, a.id);
    expect(view).toMatchObject({ reveal: false, handedIn: false, score: null, answered: 1 });
    expect(view.questions[0].mine).toEqual({ choice: 0, response: "" });
    // 26 minutes later the set is over.
    const later = new Date(Date.now() + 26 * 60_000);
    await expect(answerQuestion(ana.id, a.id, ws.items[1].id, { response: "concise" }, { grader }, later)).rejects.toThrow("Time's up");
    view = await getQuestionAssignment(ana.id, a.id, later);
    expect(view).toMatchObject({ reveal: true, handedIn: true, score: 0 });
    expect(view.questions[0].mine).toMatchObject({ correct: false });

    // An untimed set can be handed in early; after that it's locked.
    const [b] = await assignQuestions(teacher.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [ws.items[0].id], title: "Warm-up" });
    await handIn(ana.id, b.id);
    await expect(answerQuestion(ana.id, b.id, ws.items[0].id, { choice: 1 }, { grader })).rejects.toBeInstanceOf(ClassError);
    expect((await classProgress(teacher.id, c.id)).cells[`${ana.id}:${b.id}`].status).toBe("done");
  });
});
