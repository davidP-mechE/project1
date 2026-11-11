import "server-only";
import { hashPassword } from "better-auth/crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { ClassError } from "./access";
import { newJoinCode } from "./classes";
import { estimateSection, routeFor } from "@/lib/sat/practice";

/**
 * Demo mode: one tutor, one class ("Demo: SAT Math"), 10 invented students at
 * three levels, a short made-up textbook turned into a course, lesson progress,
 * quiz and diagnostic results, three assignments and a few tutor chats.
 *
 * Every demo account is flagged isDemo and uses an @demo.coursebook.invalid
 * address (a domain that can't receive mail). The demo program, class, books,
 * courses and worksheet are flagged too. Everything else hangs off those
 * accounts, so clearing deletes the demo users and the rest goes with them.
 * Real records are never touched.
 */

export const DEMO_MODE_DOMAIN = "demo.coursebook.invalid";
export const DEMO_MODE_PASSWORD = "coursebook-demo-mode";
export const DEMO_TUTOR_EMAIL = `tutor@${DEMO_MODE_DOMAIN}`;
export const DEMO_CLASS_NAME = "Demo: SAT Math";

const DAY = 86_400_000;

/** Allowed anywhere except a production deployment (unless DEMO_DATA_ALLOWED=true is set there on purpose). */
export function demoDataAllowed() {
  return process.env.APP_ENV !== "production" || process.env.DEMO_DATA_ALLOWED === "true";
}

export async function demoStatus() {
  const [users, cls] = await Promise.all([
    db.user.count({ where: { isDemo: true } }),
    db.class.findFirst({ where: { isDemo: true, name: DEMO_CLASS_NAME }, select: { id: true, joinCode: true } }),
  ]);
  return { loaded: users > 0, users, classId: cls?.id ?? null, joinCode: cls?.joinCode ?? null, allowed: demoDataAllowed() };
}

/** Delete every demo record in one step (demo users; everything they own goes with them). */
export async function clearDemoData() {
  const users = await db.user.findMany({ where: { isDemo: true }, select: { id: true } });
  // Programs cascade from their admin, classes from programs, courses and books from their owners.
  await db.user.deleteMany({ where: { isDemo: true } });
  // Anything flagged but orphaned (shouldn't happen) is removed too.
  await db.program.deleteMany({ where: { isDemo: true } });
  return { removedUsers: users.length };
}

// ─── The made-up textbook ────────────────────────────────────────────────

type Q = { prompt: string; choices: string[]; correct: number; explanation: string; topic: string };
type DemoLesson = { title: string; objectives: string[]; explanation: string; example: { title: string; problem: string; steps: string[]; answer: string }; terms: [string, string][]; questions: Q[] };
type DemoChapter = { title: string; lessons: DemoLesson[]; test: Q[] };

const BOOK_TITLE = "Foundations of SAT Algebra (demo textbook)";

const BOOK: DemoChapter[] = [
  {
    title: "Chapter 1: Linear equations",
    lessons: [
      {
        title: "Solving one-variable equations",
        objectives: ["Isolate a variable using inverse operations", "Check a solution by substituting it back"],
        explanation: "An equation is balanced: whatever you do to one side, you do to the other. To solve $3x + 5 = 20$, undo the operations in reverse order: subtract 5 from both sides to get $3x = 15$, then divide by 3 to get $x = 5$.\n\nAlways **check** by substituting: $3(5) + 5 = 20$. ✓",
        example: { title: "Two steps", problem: "Solve $4x - 7 = 21$.", steps: ["Add 7 to both sides: $4x = 28$.", "Divide both sides by 4: $x = 7$."], answer: "$x = 7$" },
        terms: [["Inverse operation", "An operation that undoes another, like subtraction undoes addition."], ["Solution", "A value that makes the equation true."]],
        questions: [
          { prompt: "Solve $2x + 6 = 14$.", choices: ["$x = 4$", "$x = 10$", "$x = 3$", "$x = 8$"], correct: 0, explanation: "Subtract 6: $2x = 8$, then divide by 2.", topic: "One-step and two-step equations" },
          { prompt: "Which value makes $5x - 3 = 12$ true?", choices: ["$x = 1.8$", "$x = 3$", "$x = 15$", "$x = 2$"], correct: 1, explanation: "Add 3: $5x = 15$, so $x = 3$.", topic: "One-step and two-step equations" },
          { prompt: "If $x/4 = 9$, what is $x$?", choices: ["$13$", "$2.25$", "$36$", "$5$"], correct: 2, explanation: "Multiply both sides by 4.", topic: "One-step and two-step equations" },
        ],
      },
      {
        title: "Equations with variables on both sides",
        objectives: ["Collect variable terms on one side", "Recognise equations with no solution or infinitely many"],
        explanation: "When $x$ appears on both sides, move all the $x$ terms to one side first. For $7x - 4 = 3x + 12$, subtract $3x$ from both sides: $4x - 4 = 12$, so $4x = 16$ and $x = 4$.\n\nIf the $x$ terms cancel and you get something false (like $2 = 5$), there is **no solution**. If you get something always true (like $3 = 3$), there are **infinitely many** solutions.",
        example: { title: "Collect like terms", problem: "Solve $6x + 2 = 2x + 18$.", steps: ["Subtract $2x$: $4x + 2 = 18$.", "Subtract 2: $4x = 16$.", "Divide by 4: $x = 4$."], answer: "$x = 4$" },
        terms: [["Like terms", "Terms with the same variable part, such as $3x$ and $-5x$."]],
        questions: [
          { prompt: "Solve $9x - 2 = 4x + 13$.", choices: ["$x = 3$", "$x = 2.2$", "$x = 11$", "$x = 5$"], correct: 0, explanation: "Subtract $4x$ and add 2: $5x = 15$.", topic: "Variables on both sides" },
          { prompt: "How many solutions does $2(x + 3) = 2x + 6$ have?", choices: ["None", "Exactly one", "Exactly two", "Infinitely many"], correct: 3, explanation: "Both sides are the same expression, so every $x$ works.", topic: "Number of solutions" },
          { prompt: "How many solutions does $3x + 1 = 3x - 4$ have?", choices: ["None", "One", "Two", "Infinitely many"], correct: 0, explanation: "Subtracting $3x$ leaves $1 = -4$, which is false.", topic: "Number of solutions" },
        ],
      },
    ],
    test: [
      { prompt: "Solve $3(x - 2) = 15$.", choices: ["$x = 7$", "$x = 3$", "$x = 5.67$", "$x = 9$"], correct: 0, explanation: "Divide by 3: $x - 2 = 5$.", topic: "One-step and two-step equations" },
      { prompt: "Solve $8 - x = 3x$.", choices: ["$x = 2$", "$x = 4$", "$x = -2$", "$x = 8$"], correct: 0, explanation: "Add $x$: $8 = 4x$.", topic: "Variables on both sides" },
      { prompt: "If $4k + 1 = 4k + c$ has infinitely many solutions, what is $c$?", choices: ["0", "1", "4", "Any number"], correct: 1, explanation: "Both sides must be identical.", topic: "Number of solutions" },
    ],
  },
  {
    title: "Chapter 2: Linear functions and graphs",
    lessons: [
      {
        title: "Slope and rate of change",
        objectives: ["Find slope from two points", "Interpret slope as a rate in context"],
        explanation: "The **slope** of a line is how much $y$ changes for each 1-unit increase in $x$: $m = \\frac{y_2 - y_1}{x_2 - x_1}$.\n\nIn context, slope is a rate. If a phone plan costs \\$15 a month plus \\$0.10 per text, the slope of cost against texts is 0.10 dollars per text.",
        example: { title: "Slope from two points", problem: "Find the slope through $(2, 5)$ and $(6, 13)$.", steps: ["Change in $y$: $13 - 5 = 8$.", "Change in $x$: $6 - 2 = 4$.", "Slope $= 8/4 = 2$."], answer: "$m = 2$" },
        terms: [["Slope", "Rise over run: the change in $y$ per unit change in $x$."], ["Rate of change", "How fast one quantity changes compared with another."]],
        questions: [
          { prompt: "What is the slope through $(1, 2)$ and $(3, 10)$?", choices: ["4", "8", "2", "$\\frac{1}{4}$"], correct: 0, explanation: "$(10 - 2)/(3 - 1) = 4$.", topic: "Slope" },
          { prompt: "A taxi charges \\$3 plus \\$2 per mile. What does the 2 represent?", choices: ["The starting fee", "Dollars per mile", "Miles per dollar", "The total cost"], correct: 1, explanation: "It's the rate: cost goes up \\$2 for each mile.", topic: "Interpreting slope" },
          { prompt: "A horizontal line has slope…", choices: ["1", "Undefined", "0", "-1"], correct: 2, explanation: "$y$ never changes, so the rise is 0.", topic: "Slope" },
        ],
      },
      {
        title: "Slope-intercept form",
        objectives: ["Write $y = mx + b$ from a description", "Read the slope and intercept from an equation"],
        explanation: "In $y = mx + b$, $m$ is the slope and $b$ is the **y-intercept**: the value of $y$ when $x = 0$. For $y = 3x - 4$, the line crosses the $y$-axis at $-4$ and rises 3 for every 1 to the right.",
        example: { title: "From a description", problem: "A plant is 6 cm tall and grows 2 cm a week. Write its height $h$ after $w$ weeks.", steps: ["Starting height is the intercept: 6.", "Growth per week is the slope: 2."], answer: "$h = 2w + 6$" },
        terms: [["y-intercept", "Where a line crosses the $y$-axis (when $x = 0$)."]],
        questions: [
          { prompt: "What is the y-intercept of $y = -2x + 7$?", choices: ["$-2$", "7", "$3.5$", "$-7$"], correct: 1, explanation: "It's the constant term, $b = 7$.", topic: "Slope-intercept form" },
          { prompt: "Which line has slope 4 and passes through $(0, -1)$?", choices: ["$y = -x + 4$", "$y = 4x - 1$", "$y = 4x + 1$", "$y = -4x - 1$"], correct: 1, explanation: "$m = 4$, $b = -1$.", topic: "Slope-intercept form" },
          { prompt: "A gym costs \\$20 to join and \\$12 a month. Which gives the cost after $m$ months?", choices: ["$C = 20m + 12$", "$C = 12m + 20$", "$C = 32m$", "$C = 12m - 20$"], correct: 1, explanation: "Monthly rate is the slope; joining fee is the intercept.", topic: "Modelling with linear functions" },
        ],
      },
    ],
    test: [
      { prompt: "What is the slope of $2y = 6x + 4$?", choices: ["6", "3", "2", "4"], correct: 1, explanation: "Divide by 2: $y = 3x + 2$.", topic: "Slope-intercept form" },
      { prompt: "A line passes through $(0, 5)$ and $(2, 1)$. Its equation is…", choices: ["$y = -2x + 5$", "$y = 2x + 5$", "$y = -0.5x + 5$", "$y = 5x - 2$"], correct: 0, explanation: "Slope $(1 - 5)/2 = -2$, intercept 5.", topic: "Slope" },
      { prompt: "In $C = 0.25t + 9$, what does 9 mean?", choices: ["Cost per text", "Cost with zero texts", "Number of texts", "Total texts allowed"], correct: 1, explanation: "The intercept is the cost when $t = 0$.", topic: "Interpreting slope" },
    ],
  },
  {
    title: "Chapter 3: Systems of linear equations",
    lessons: [
      {
        title: "Solving by substitution",
        objectives: ["Solve one equation for a variable", "Substitute into the other equation"],
        explanation: "A **system** is two equations that must both be true. With $y = 2x$ and $x + y = 9$, substitute $2x$ for $y$: $x + 2x = 9$, so $x = 3$ and $y = 6$.",
        example: { title: "Substitution", problem: "Solve $y = x + 1$ and $2x + y = 10$.", steps: ["Substitute: $2x + (x + 1) = 10$.", "So $3x = 9$, $x = 3$.", "Then $y = 4$."], answer: "$(3, 4)$" },
        terms: [["System of equations", "Two or more equations solved together."]],
        questions: [
          { prompt: "Solve $y = 3x$ and $x + y = 12$. What is $x$?", choices: ["3", "4", "9", "12"], correct: 0, explanation: "$x + 3x = 12$, so $x = 3$.", topic: "Substitution" },
          { prompt: "If $y = x - 2$ and $y = 4$, what is $x$?", choices: ["2", "4", "6", "-2"], correct: 2, explanation: "$4 = x - 2$.", topic: "Substitution" },
          { prompt: "Tickets cost \\$5 (child) and \\$8 (adult). 10 tickets cost \\$65. How many adult tickets?", choices: ["3", "5", "7", "2"], correct: 1, explanation: "$5c + 8a = 65$ and $c + a = 10$ give $a = 5$.", topic: "Word problems with systems" },
        ],
      },
      {
        title: "Solving by elimination",
        objectives: ["Add or subtract equations to cancel a variable", "Know when a system has no solution"],
        explanation: "Line up the equations and add or subtract so one variable cancels. For $x + y = 7$ and $x - y = 1$, adding gives $2x = 8$, so $x = 4$, $y = 3$.\n\nParallel lines (same slope, different intercepts) never meet: **no solution**.",
        example: { title: "Elimination", problem: "Solve $3x + 2y = 16$ and $x - 2y = 0$.", steps: ["Add the equations: $4x = 16$.", "$x = 4$, so $2y = 4$ and $y = 2$."], answer: "$(4, 2)$" },
        terms: [["Elimination", "Combining equations so one variable cancels out."]],
        questions: [
          { prompt: "Solve $x + y = 10$ and $x - y = 4$. What is $y$?", choices: ["7", "3", "6", "4"], correct: 1, explanation: "Adding gives $x = 7$, so $y = 3$.", topic: "Elimination" },
          { prompt: "How many solutions do $y = 2x + 1$ and $y = 2x - 5$ have?", choices: ["None", "One", "Two", "Infinitely many"], correct: 0, explanation: "Same slope, different intercepts: parallel.", topic: "Number of solutions" },
          { prompt: "Subtract to eliminate $x$: $2x + y = 9$, $2x - 3y = 1$. Then $y = $", choices: ["1", "2", "3", "4"], correct: 1, explanation: "Subtracting gives $4y = 8$.", topic: "Elimination" },
        ],
      },
    ],
    test: [
      { prompt: "Solve $2x + y = 11$ and $x - y = 1$.", choices: ["$(4, 3)$", "$(3, 5)$", "$(5, 1)$", "$(2, 7)$"], correct: 0, explanation: "Add: $3x = 12$.", topic: "Elimination" },
      { prompt: "Which system has infinitely many solutions?", choices: ["$y = x$, $y = x + 1$", "$y = 2x$, $2y = 4x$", "$y = x$, $y = -x$", "$y = 3$, $x = 3$"], correct: 1, explanation: "The second equation is the first, doubled.", topic: "Number of solutions" },
      { prompt: "Pens cost \\$2 and notebooks \\$3. 7 items cost \\$17. How many notebooks?", choices: ["2", "3", "4", "5"], correct: 1, explanation: "$p + n = 7$ and $2p + 3n = 17$ give $n = 3$.", topic: "Word problems with systems" },
    ],
  },
  {
    title: "Chapter 4: Quadratics",
    lessons: [
      {
        title: "Factoring quadratics",
        objectives: ["Factor $x^2 + bx + c$", "Use the zero-product property"],
        explanation: "To factor $x^2 + 5x + 6$, find two numbers that multiply to 6 and add to 5: 2 and 3. So $x^2 + 5x + 6 = (x + 2)(x + 3)$.\n\nIf a product is zero, one of the factors is zero, so $(x + 2)(x + 3) = 0$ gives $x = -2$ or $x = -3$.",
        example: { title: "Factor and solve", problem: "Solve $x^2 - x - 12 = 0$.", steps: ["Find numbers that multiply to $-12$ and add to $-1$: $-4$ and $3$.", "$(x - 4)(x + 3) = 0$.", "$x = 4$ or $x = -3$."], answer: "$x = 4$ or $x = -3$" },
        terms: [["Zero-product property", "If $ab = 0$, then $a = 0$ or $b = 0$."]],
        questions: [
          { prompt: "Factor $x^2 + 7x + 10$.", choices: ["$(x + 2)(x + 5)$", "$(x + 1)(x + 10)$", "$(x - 2)(x - 5)$", "$(x + 3)(x + 4)$"], correct: 0, explanation: "2 × 5 = 10 and 2 + 5 = 7.", topic: "Factoring" },
          { prompt: "Solve $(x - 6)(x + 1) = 0$.", choices: ["$6$ or $-1$", "$-6$ or $1$", "$6$ only", "$-1$ only"], correct: 0, explanation: "Set each factor to zero.", topic: "Zero-product property" },
          { prompt: "Which is a solution of $x^2 = 9x$?", choices: ["3", "9", "-9", "81"], correct: 1, explanation: "$x(x - 9) = 0$, so $x = 0$ or $9$.", topic: "Factoring" },
        ],
      },
      {
        title: "The vertex and the parabola",
        objectives: ["Find the vertex of $y = a(x - h)^2 + k$", "Tell whether a parabola opens up or down"],
        explanation: "In **vertex form** $y = a(x - h)^2 + k$, the vertex is $(h, k)$. If $a > 0$ the parabola opens up and the vertex is a minimum; if $a < 0$ it opens down and the vertex is a maximum.",
        example: { title: "Read the vertex", problem: "Find the vertex of $y = -2(x - 3)^2 + 5$.", steps: ["Compare with $a(x - h)^2 + k$: $h = 3$, $k = 5$.", "$a = -2 < 0$, so it's a maximum."], answer: "Vertex $(3, 5)$, a maximum" },
        terms: [["Vertex", "The turning point of a parabola."], ["Vertex form", "$y = a(x - h)^2 + k$."]],
        questions: [
          { prompt: "What is the vertex of $y = (x + 2)^2 - 7$?", choices: ["$(2, -7)$", "$(-2, -7)$", "$(-2, 7)$", "$(7, -2)$"], correct: 1, explanation: "$x + 2 = x - (-2)$, so $h = -2$.", topic: "Vertex form" },
          { prompt: "Does $y = -x^2 + 4$ open up or down?", choices: ["Up", "Down", "Neither", "Both"], correct: 1, explanation: "$a = -1 < 0$.", topic: "Parabolas" },
          { prompt: "A ball's height is $h = -5(t - 2)^2 + 20$. What is the greatest height?", choices: ["2", "5", "20", "-5"], correct: 2, explanation: "The vertex $k = 20$ is the maximum.", topic: "Vertex form" },
        ],
      },
    ],
    test: [
      { prompt: "Solve $x^2 - 5x + 6 = 0$.", choices: ["2 or 3", "-2 or -3", "1 or 6", "5 or 6"], correct: 0, explanation: "$(x - 2)(x - 3) = 0$.", topic: "Factoring" },
      { prompt: "Vertex of $y = 3(x - 1)^2 + 4$?", choices: ["$(1, 4)$", "$(-1, 4)$", "$(3, 4)$", "$(1, -4)$"], correct: 0, explanation: "$h = 1$, $k = 4$.", topic: "Vertex form" },
      { prompt: "Which parabola has a minimum?", choices: ["$y = -x^2$", "$y = 2x^2 - 1$", "$y = -3(x - 1)^2$", "$y = 5 - x^2$"], correct: 1, explanation: "$a = 2 > 0$ opens up.", topic: "Parabolas" },
    ],
  },
];

// ─── People ──────────────────────────────────────────────────────────────

type Level = "strong" | "average" | "struggling";
const STUDENTS: { name: string; level: Level; ability: number; lessonsDone: number; neverStarted?: boolean; lateOnA2?: boolean }[] = [
  { name: "Maya Okafor", level: "strong", ability: 0.92, lessonsDone: 8 },
  { name: "Leo Brandt", level: "strong", ability: 0.88, lessonsDone: 8 },
  { name: "Priya Sandoval", level: "average", ability: 0.74, lessonsDone: 6 },
  { name: "Owen Castillo", level: "average", ability: 0.7, lessonsDone: 5 },
  { name: "Hana Whitlock", level: "average", ability: 0.68, lessonsDone: 4, lateOnA2: true },
  { name: "Mateo Lindqvist", level: "average", ability: 0.66, lessonsDone: 4 },
  { name: "Grace Abernathy", level: "average", ability: 0.62, lessonsDone: 4, lateOnA2: true },
  { name: "Ezra Quill", level: "struggling", ability: 0.45, lessonsDone: 2 },
  { name: "Sofia Marchetti", level: "struggling", ability: 0.4, lessonsDone: 1 },
  { name: "Dev Ramanathan", level: "struggling", ability: 0.35, lessonsDone: 0, neverStarted: true },
];

const COLORS = ["#14213d", "#4f7cac", "#b5654d", "#5b8a5f", "#8a5a9e", "#c9a227", "#2f6f73", "#a3301d", "#55606e", "#6b4f2a"];

/** A simple avatar (initials on a coloured disc) as an inline SVG, so nothing is fetched from elsewhere. */
function avatar(name: string, i: number) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${COLORS[i % COLORS.length]}"/><text x="32" y="40" text-anchor="middle" font-family="Georgia,serif" font-size="24" font-weight="700" fill="#fbf5e6">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// Deterministic randomness, so the demo looks the same every time.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lessonContent = (l: DemoLesson): Prisma.InputJsonValue => ({
  objectives: l.objectives,
  explanation: l.explanation,
  workedExamples: [{ ...l.example, pageRefs: [] }],
  keyTerms: l.terms.map(([term, definition]) => ({ term, definition, pageRefs: [] })),
});

type Tx = Prisma.TransactionClient;

/** A course (book + units + lessons + questions + unit tests) owned by `userId`. Returns ids by position. */
async function buildCourse(tx: Tx, userId: string, opts: { classCourseId?: string; sourceLessons?: string[][] } = {}) {
  const book = await tx.book.create({ data: { userId, originalFilename: "foundations-of-sat-algebra-demo.pdf", storageKey: `demo/${userId}/book.pdf`, sizeBytes: BigInt(1), pageCount: 48, status: "READY", rightsConfirmed: true, isDemo: true } });
  const course = await tx.course.create({ data: { userId, bookId: book.id, title: BOOK_TITLE, status: "ACTIVE", subject: "math", outlineSource: "HEADINGS", isDemo: true, ...(opts.classCourseId ? { classCourseId: opts.classCourseId } : {}) } });
  const lessons: string[][] = [];
  const questions: string[][][] = [];
  const tests: { id: string; questions: string[] }[] = [];
  let page = 1;
  for (const [ui, ch] of BOOK.entries()) {
    const unit = await tx.unit.create({ data: { courseId: course.id, order: ui, title: ch.title } });
    lessons.push([]);
    questions.push([]);
    for (const [li, l] of ch.lessons.entries()) {
      const lesson = await tx.lesson.create({
        data: { unitId: unit.id, courseId: course.id, order: li, title: l.title, pageStart: page, pageEnd: page + 5, status: "READY", content: lessonContent(l), generatedAt: new Date(), model: "demo", sourceLessonId: opts.sourceLessons?.[ui]?.[li] ?? null },
      });
      page += 6;
      lessons[ui].push(lesson.id);
      const qs = [];
      for (const [qi, q] of l.questions.entries()) {
        qs.push((await tx.question.create({ data: { courseId: course.id, lessonId: lesson.id, scope: "LESSON", type: "MULTIPLE_CHOICE", order: qi, prompt: q.prompt, choices: q.choices, correctChoice: q.correct, answer: q.choices[q.correct], explanation: q.explanation, steps: [], topic: q.topic } })).id);
      }
      questions[ui].push(qs);
      await tx.flashcard.createMany({ data: l.terms.map(([front, back], fi) => ({ courseId: course.id, lessonId: lesson.id, order: fi, front, back, pageRefs: [] })) });
    }
    const test = await tx.assessment.create({ data: { courseId: course.id, unitId: unit.id, kind: "UNIT_TEST", status: "READY", summary: `A quick check on ${ch.title.replace(/^Chapter \d+: /, "").toLowerCase()}.`, generatedAt: new Date(), model: "demo" } });
    const tq = [];
    for (const [qi, q] of ch.test.entries()) {
      tq.push((await tx.question.create({ data: { courseId: course.id, scope: "UNIT_TEST", type: "MULTIPLE_CHOICE", order: qi, prompt: q.prompt, choices: q.choices, correctChoice: q.correct, answer: q.choices[q.correct], explanation: q.explanation, steps: [], topic: q.topic, assessmentId: test.id } })).id);
    }
    tests.push({ id: test.id, questions: tq });
  }
  return { course, lessons, questions, tests };
}

const CHATS: { student: number; lesson: [number, number]; title: string; turns: [string, string][] }[] = [
  {
    student: 2,
    lesson: [1, 0],
    title: "Why is slope rise over run?",
    turns: [
      ["Why do we divide the change in y by the change in x and not the other way round?", "Slope tells you how much **y** changes for each 1-unit step in **x**. If you divided the other way you'd get how much x changes per unit of y, which is a different rate. For $(2, 5)$ and $(6, 13)$: y goes up 8 while x goes up 4, so y rises 2 for every 1 in x. That 2 is the slope."],
      ["So a bigger slope means a steeper line?", "Yes. A slope of 5 climbs faster than a slope of 2. A negative slope goes down from left to right, and a slope of 0 is flat."],
    ],
  },
  {
    student: 7,
    lesson: [0, 1],
    title: "No solution vs infinitely many",
    turns: [
      ["I got 3 = 3 when I solved 2(x+3) = 2x + 9 - 3. Did I do something wrong?", "You didn't! When the x terms cancel and you're left with something that's always true, like $3 = 3$ (or here $6 = 6$), the equation is true for **every** value of x. That means infinitely many solutions."],
      ["And if I get something like 1 = -4?", "Then it's never true, so there's **no solution**. The two sides can never be equal, whatever x is."],
    ],
  },
  {
    student: 4,
    lesson: [2, 0],
    title: "Setting up the ticket problem",
    turns: [["How do I know which equation to write first for the ticket question?", "Start with what you're told. There are two facts: the number of tickets (c + a = 10) and the total cost (5c + 8a = 65). Each fact becomes one equation. Then solve the first for c (c = 10 − a) and substitute it into the second."]],
  },
  {
    student: 0,
    lesson: [3, 1],
    title: "Vertex form shortcut",
    turns: [["Is there a quick way to find the max height without graphing?", "If the equation is in vertex form, $h = a(t - h_0)^2 + k$, the maximum (when $a < 0$) is just $k$. For $-5(t - 2)^2 + 20$ that's 20, reached at $t = 2$. No graphing needed."]],
  },
];

/** Load the demo: refuses if it's already loaded (clear first) or if demo data isn't allowed here. */
export async function loadDemoData(now = new Date()) {
  if (!demoDataAllowed()) throw new ClassError("Demo data is turned off on this deployment.", 403);
  if (await db.user.count({ where: { isDemo: true } })) throw new ClassError("Demo data is already loaded. Clear it first to reload.");
  const rand = rng(1600);
  const hash = await hashPassword(DEMO_MODE_PASSWORD);
  const t0 = now.getTime();
  const at = (daysAgo: number, hour = 17) => new Date(Math.floor((t0 - daysAgo * DAY) / DAY) * DAY + hour * 3600_000);

  const mkUser = async (tx: Tx, local: string, name: string, image: string | null) => {
    const email = `${local}@${DEMO_MODE_DOMAIN}`;
    const u = await tx.user.create({ data: { id: `demomode_${local}`, name, email, emailVerified: true, image, isDemo: true, timezone: "America/New_York", lastLoginAt: at(1) } });
    await tx.account.create({ data: { id: `demomode_acc_${local}`, accountId: u.id, providerId: "credential", userId: u.id, password: hash } });
    return u;
  };

  return db.$transaction(
    async (tx) => {
      const tutor = await mkUser(tx, "tutor", "Jordan Whitfield", avatar("Jordan Whitfield", 0));
      const students = [];
      for (const [i, s] of STUDENTS.entries()) students.push({ ...s, user: await mkUser(tx, `student${i + 1}`, s.name, avatar(s.name, i + 1)) });

      const program = await tx.program.create({ data: { adminId: tutor.id, name: "Demo Tutoring Program", badge: "DEMO", targets: [1200, 1300], isDemo: true } });
      const cls = await tx.class.create({ data: { programId: program.id, teacherId: tutor.id, name: DEMO_CLASS_NAME, joinCode: newJoinCode(), isDemo: true, createdAt: at(60) } });
      await tx.classStaff.create({ data: { classId: cls.id, userId: tutor.id, role: "TEACHER" } });
      await tx.classMember.createMany({ data: students.map((s) => ({ classId: cls.id, userId: s.user.id, joinedAt: at(55) })) });

      // The tutor's course, shared with the class; each student who started has their own copy.
      const src = await buildCourse(tx, tutor.id);
      const classCourse = await tx.classCourse.create({ data: { classId: cls.id, sourceCourseId: src.course.id, title: BOOK_TITLE, createdAt: at(50) } });
      const flatLessons = src.lessons.flat();

      for (const [si, s] of students.entries()) {
        // Baseline scores that match the level.
        const total = Math.round((780 + s.ability * 520) / 10) * 10;
        await tx.scoreRecord.create({ data: { studentId: s.user.id, source: "PSAT", takenOn: at(70, 0), total, rw: Math.round(total / 20) * 10, math: total - Math.round(total / 20) * 10, isBaseline: true, enteredById: tutor.id, verifiedById: tutor.id, verifiedAt: at(60) } });
        if (s.neverStarted) continue;
        // A Bluebook practice test in October, with gains that match the level, and College Board's
        // Knowledge and Skills bands (1–7) for the Math domains, so Scores, Trends and Skills have something to show.
        const gain = Math.round((s.level === "strong" ? 60 + rand() * 30 : s.level === "average" ? 20 + rand() * 40 : rand() * 20) / 10) * 10;
        const later = Math.min(1600, total + gain);
        const band = (shift: number) => Math.max(1, Math.min(7, Math.round(1 + s.ability * 6 + shift + (rand() - 0.5))));
        await tx.scoreRecord.create({
          data: {
            studentId: s.user.id,
            source: "PRACTICE_BLUEBOOK",
            testName: "Bluebook Practice Test 4",
            takenOn: at(20, 0),
            total: later,
            rw: Math.round(later / 20) * 10,
            math: later - Math.round(later / 20) * 10,
            domainBands: { algebra: band(0.3), "advanced-math": band(-0.8), psda: band(0), "geo-trig": band(-0.4) },
            enteredById: s.user.id,
          },
        });
        const copy = await buildCourse(tx, s.user.id, { classCourseId: classCourse.id, sourceLessons: src.lessons });
        const copyLessons = copy.lessons.flat();
        const copyQuestions = copy.questions.flat();
        for (let li = 0; li < copyLessons.length; li++) {
          const done = li < s.lessonsDone;
          const viewed = done || li === s.lessonsDone; // halfway through the next one
          if (!viewed) continue;
          // Chapters 1–2 are assignment 2 (due 3 days ago); late students finished chapter 2 after that.
          const day = s.lateOnA2 && li >= 2 && li < 4 ? 4 - li : 45 - li * 5 + Math.floor(rand() * 3);
          await tx.lessonProgress.create({ data: { userId: s.user.id, courseId: copy.course.id, lessonId: copyLessons[li], completedAt: done ? at(day) : null, lastViewedAt: at(done ? day : 2), confusing: !done && s.level === "struggling" } });
          if (!done) continue;
          // Practice questions on finished lessons, right as often as the student's level.
          for (const [qi, qid] of copyQuestions[li].entries()) {
            const q = BOOK[Math.floor(li / 2)].lessons[li % 2].questions[qi];
            const ok = rand() < s.ability;
            const choice = ok ? q.correct : (q.correct + 1 + Math.floor(rand() * 3)) % 4;
            await tx.questionAttempt.create({ data: { userId: s.user.id, courseId: copy.course.id, lessonId: copyLessons[li], questionId: qid, topic: q.topic, choice, response: q.choices[choice], verdict: ok ? "CORRECT" : "INCORRECT", correct: ok, score: ok ? 1 : 0, feedback: ok ? "Correct." : q.explanation, gradedBy: "LOCAL", createdAt: at(day) } });
          }
        }
        // Unit tests for every chapter the student finished.
        for (const [ui, test] of copy.tests.entries()) {
          if (s.lessonsDone < (ui + 1) * 2) continue;
          let right = 0;
          const testDay = s.lateOnA2 && ui === 1 ? 1 : 40 - ui * 10;
          const attempt = await tx.assessmentAttempt.create({ data: { userId: s.user.id, courseId: copy.course.id, assessmentId: test.id, score: 0, correct: 0, total: test.questions.length, createdAt: at(testDay) } });
          for (const [qi, qid] of test.questions.entries()) {
            const q = BOOK[ui].test[qi];
            const ok = rand() < s.ability;
            if (ok) right++;
            const choice = ok ? q.correct : (q.correct + 1) % 4;
            await tx.questionAttempt.create({ data: { userId: s.user.id, courseId: copy.course.id, questionId: qid, topic: q.topic, choice, response: q.choices[choice], verdict: ok ? "CORRECT" : "INCORRECT", correct: ok, score: ok ? 1 : 0, feedback: ok ? "Correct." : q.explanation, gradedBy: "LOCAL", assessmentAttemptId: attempt.id, createdAt: at(testDay) } });
          }
          await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { score: right / test.questions.length, correct: right } });
        }
        // Study days, for streaks and the Today chart.
        const days = [];
        for (let d = 0; d < 30; d++) if (rand() < s.ability - 0.15) days.push({ userId: s.user.id, day: new Date(t0 - d * DAY).toISOString().slice(0, 10), minutes: 5 + Math.floor(rand() * 35 * s.ability), questionsAnswered: 2 + Math.floor(rand() * 10), questionsCorrect: 1 + Math.floor(rand() * 6) });
        await tx.studyDay.createMany({ data: days, skipDuplicates: true });
        // Tutor chats.
        for (const chat of CHATS.filter((c) => c.student === si)) {
          const lessonId = copy.lessons[chat.lesson[0]][chat.lesson[1]];
          const thread = await tx.tutorThread.create({ data: { userId: s.user.id, courseId: copy.course.id, lessonId, title: chat.title, createdAt: at(6), updatedAt: at(6) } });
          let m = 0;
          for (const [ask, reply] of chat.turns) {
            await tx.tutorMessage.create({ data: { threadId: thread.id, role: "USER", content: ask, createdAt: new Date(at(6).getTime() + m++ * 60_000) } });
            await tx.tutorMessage.create({ data: { threadId: thread.id, role: "ASSISTANT", content: reply, status: "DONE", sources: [], createdAt: new Date(at(6).getTime() + m++ * 60_000) } });
          }
        }
      }

      // A worksheet of original, tagged questions for the question-set assignments and the diagnostic.
      const ws = await tx.worksheet.create({
        data: {
          ownerId: tutor.id,
          title: "Demo practice questions",
          fileKey: `demo/${tutor.id}/worksheet.pdf`,
          sizeBytes: BigInt(1),
          status: "READY",
          isDemo: true,
          items: {
            create: BOOK.flatMap((ch) => [...ch.lessons.flatMap((l) => l.questions), ...ch.test]).slice(0, 16).map((q, n) => ({ order: n, label: String(n + 1), type: "MULTIPLE_CHOICE" as const, prompt: q.prompt, choices: q.choices, correctChoice: q.correct, answer: q.choices[q.correct], explanation: q.explanation, topic: q.topic, section: "MATH", domain: n < 12 ? "algebra" : "advanced-math", skill: n < 12 ? "Linear equations in one variable" : "Nonlinear functions", tagsConfirmed: true, approvedAt: at(50), approvedById: tutor.id, difficulty: ["EASY", "MEDIUM", "HARD"][n % 3] })),
          },
        },
        include: { items: { orderBy: { order: "asc" } } },
      });
      const items = ws.items;

      // Assignment 1: everyone finished (a short question set, two weeks ago).
      const a1Items = items.slice(0, 4);
      const a1 = await tx.assignment.create({ data: { classId: cls.id, kind: "QUESTIONS", title: "Warm-up: linear equations", worksheetId: ws.id, itemIds: a1Items.map((x) => x.id), section: "MATH", domains: ["algebra"], dueAt: at(14, 23), createdAt: at(21) } });
      // Assignment 2: lessons from the course (chapters 1–2), due a few days ago: some late, some missing.
      const a2 = await tx.assignment.create({ data: { classId: cls.id, kind: "LESSONS", title: "Read chapters 1 and 2", classCourseId: classCourse.id, lessonIds: flatLessons.slice(0, 4), dueAt: at(3, 23), createdAt: at(17) } });
      // Assignment 3: due next week, a few have started.
      const a3Items = items.slice(8, 12);
      const a3 = await tx.assignment.create({ data: { classId: cls.id, kind: "QUESTIONS", title: "Systems of equations practice", worksheetId: ws.id, itemIds: a3Items.map((x) => x.id), section: "MATH", domains: ["algebra"], dueAt: at(-7, 23), createdAt: at(1) } });

      for (const [si, s] of students.entries()) {
        // A1: everyone, on time.
        const when1 = at(15 + (si % 3));
        await tx.assignmentStart.create({ data: { assignmentId: a1.id, userId: s.user.id, startedAt: when1, submittedAt: when1 } });
        for (const it of a1Items) {
          const ok = rand() < s.ability;
          const choice = ok ? it.correctChoice! : (it.correctChoice! + 1) % 4;
          await tx.assignmentAnswer.create({ data: { assignmentId: a1.id, itemId: it.id, userId: s.user.id, choice, correct: ok, score: ok ? 1 : 0, verdict: ok ? "correct" : "incorrect", gradedBy: "auto", createdAt: when1 } });
        }
        // A3: the two strong students and one average student have started.
        if (si <= 2) {
          const when3 = at(si === 2 ? 0 : 1);
          await tx.assignmentStart.create({ data: { assignmentId: a3.id, userId: s.user.id, startedAt: when3, submittedAt: si < 2 ? when3 : null } });
          for (const it of si < 2 ? a3Items : a3Items.slice(0, 2)) {
            const ok = rand() < s.ability;
            const choice = ok ? it.correctChoice! : (it.correctChoice! + 1) % 4;
            await tx.assignmentAnswer.create({ data: { assignmentId: a3.id, itemId: it.id, userId: s.user.id, choice, correct: ok, score: ok ? 1 : 0, verdict: ok ? "correct" : "incorrect", gradedBy: "auto", createdAt: when3 } });
          }
        }
      }
      void a2; // A2's progress comes from each student's lesson progress above.

      // A diagnostic (adaptive, Math only) every student but one has taken.
      const diag = await tx.diagnostic.create({
        data: {
          programId: program.id,
          createdById: tutor.id,
          title: "Demo diagnostic (Math)",
          status: "PUBLISHED",
          createdAt: at(40),
          modules: {
            create: [
              { section: "MATH", stage: "M1", timeLimitSec: 900, itemIds: items.slice(0, 4).map((x) => x.id), routeThreshold: 3 },
              { section: "MATH", stage: "M2_HARD", timeLimitSec: 900, itemIds: items.slice(12, 16).map((x) => x.id) },
              { section: "MATH", stage: "M2_EASY", timeLimitSec: 900, itemIds: items.slice(4, 8).map((x) => x.id) },
            ],
          },
        },
        include: { modules: true },
      });
      const mod = (stage: string) => diag.modules.find((m) => m.stage === stage)!;
      const diagA = await tx.assignment.create({ data: { classId: cls.id, kind: "DIAGNOSTIC", title: "Demo diagnostic (Math)", diagnosticId: diag.id, section: "MATH", domains: [], opensAt: at(40), closesAt: at(30), dueAt: at(30), createdAt: at(41) } });
      for (const s of students) {
        if (s.neverStarted) continue;
        const m1 = mod("M1");
        // Right answers track ability, with a little noise (±1 question).
        const right = (n: number, p: number) => Math.max(0, Math.min(n, Math.round(n * p + (rand() - 0.5) * 1.2)));
        const m1Right = right(m1.itemIds.length, s.ability);
        const m2 = mod(routeFor(m1Right, m1.routeThreshold));
        const m2Right = right(m2.itemIds.length, s.ability + (m2.stage === "M2_HARD" ? -0.1 : 0.05));
        const correct = m1Right + m2Right;
        const totalQ = m1.itemIds.length + m2.itemIds.length;
        const estimate = estimateSection(correct, totalQ, m2.stage as "M2_HARD" | "M2_EASY");
        const attempt = await tx.diagnosticAttempt.create({
          data: { assignmentId: diagA.id, userId: s.user.id, path: [m1.id, m2.id], startedAt: at(35, 15), finishedAt: at(35, 16), results: { sections: [{ section: "MATH", route: m2.stage, correct, total: totalQ, estimate }], total: null } },
        });
        let k = 0;
        for (const [mm, right] of [[m1, m1Right], [m2, m2Right]] as const) {
          for (const [ii, itemId] of mm.itemIds.entries()) {
            const it = items.find((x) => x.id === itemId)!;
            const ok = ii < right;
            await tx.diagnosticAnswer.create({ data: { attemptId: attempt.id, moduleId: mm.id, itemId, choice: ok ? it.correctChoice : (it.correctChoice! + 1) % 4, correct: ok, timeMs: 40_000 + k++ * 1000 } });
          }
        }
      }

      return { tutorEmail: tutor.email, password: DEMO_MODE_PASSWORD, classId: cls.id, joinCode: cls.joinCode, students: students.length };
    },
    { timeout: 120_000 },
  );
}
