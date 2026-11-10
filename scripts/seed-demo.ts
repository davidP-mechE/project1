/**
 * Demo data: a fake tutoring program with a year of realistic activity, for
 * trying the site, screenshots and performance checks. Every name is invented;
 * no real person is in it. All demo accounts use @demo.example.com addresses.
 *
 *   npm run seed:demo            # create (or re-create) the demo program
 *   npm run seed:demo -- --remove   # delete every demo account and its data
 *
 * Refuses to run against production (APP_ENV=production) unless --force.
 * Turn on the log-in buttons on /login with DEMO_LOGINS=true (never in production).
 */
import { hashPassword } from "better-auth/crypto";
import { db } from "../src/server/db";
import { DEMO_DOMAIN, DEMO_PASSWORD } from "../src/lib/demo";

// Deterministic randomness, so the demo looks the same every time.
let seed = 1600;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const normal = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const round10 = (n: number) => Math.round(n / 10) * 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const DAY = 86_400_000;

const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Quinn", "Rowan", "Skyler", "Emerson", "Hayden", "Reese", "Parker", "Finley", "Dakota", "Sage", "Blake", "Kendall", "Marlowe", "Tatum", "Ellis", "Arden", "Lennox", "Shiloh", "Remy", "Briar", "Oakley", "Indigo", "Harper", "Wren", "Zion", "Lux"];
const LAST = ["Alder", "Brightwater", "Calloway", "Dunmore", "Everly", "Fairbanks", "Greenleaf", "Holloway", "Ivers", "Juniper", "Kestrel", "Lockridge", "Merriweather", "Northcott", "Oakhurst", "Pennington", "Quillfeather", "Ravensworth", "Stillwater", "Thornbury"];

/** Original practice questions (written for this demo; nothing official). */
const QUESTIONS: { section: "MATH" | "RW"; domain: string; skill: string; prompt: string; choices: string[]; correct: number }[] = [
  { section: "MATH", domain: "algebra", skill: "Linear equations in one variable", prompt: "If 4x − 7 = 21, what is the value of x?", choices: ["3.5", "7", "14", "28"], correct: 1 },
  { section: "MATH", domain: "algebra", skill: "Linear functions", prompt: "A plan costs $12 a month plus $0.05 per text. Which expression gives the monthly cost for t texts?", choices: ["12t + 0.05", "0.05t + 12", "12.05t", "(12 + t) × 0.05"], correct: 1 },
  { section: "MATH", domain: "advanced-math", skill: "Nonlinear functions", prompt: "If f(x) = x² − 3x, what is f(5)?", choices: ["10", "16", "22", "40"], correct: 0 },
  { section: "MATH", domain: "advanced-math", skill: "Equivalent expressions", prompt: "Which expression is equivalent to (x + 3)(x − 3)?", choices: ["x² − 9", "x² + 9", "x² − 6x − 9", "2x"], correct: 0 },
  { section: "MATH", domain: "psda", skill: "Percentages", prompt: "A jacket that costs $80 is on sale for 25% off. What is the sale price?", choices: ["$55", "$60", "$64", "$75"], correct: 1 },
  { section: "MATH", domain: "psda", skill: "One-variable data", prompt: "The data set 4, 7, 7, 9, 13 has what median?", choices: ["7", "8", "9", "8.5"], correct: 0 },
  { section: "MATH", domain: "geo-trig", skill: "Area and volume", prompt: "A rectangle is 6 cm by 9 cm. What is its area in square centimetres?", choices: ["15", "30", "54", "81"], correct: 2 },
  { section: "MATH", domain: "geo-trig", skill: "Right triangles and trigonometry", prompt: "A right triangle has legs of 6 and 8. How long is the hypotenuse?", choices: ["10", "12", "14", "48"], correct: 0 },
  { section: "RW", domain: "info-ideas", skill: "Central ideas and details", prompt: "A passage describes a town that rebuilt its library with volunteers after a flood. Which choice best states its main idea?", choices: ["Floods are common in small towns.", "The community worked together to restore a shared place.", "Libraries need more funding.", "Volunteers prefer outdoor work."], correct: 1 },
  { section: "RW", domain: "info-ideas", skill: "Command of evidence", prompt: "A student claims that bees prefer blue flowers. Which finding would best support the claim?", choices: ["Bees visited blue flowers twice as often as others in a test garden.", "Some flowers are blue.", "Bees can fly long distances.", "Gardeners like blue flowers."], correct: 0 },
  { section: "RW", domain: "craft-structure", skill: "Words in context", prompt: "\"The committee's response was measured, avoiding any strong promises.\" As used here, \"measured\" most nearly means:", choices: ["calculated in units", "careful and restrained", "lengthy", "rhythmic"], correct: 1 },
  { section: "RW", domain: "craft-structure", skill: "Text structure and purpose", prompt: "A paragraph opens with a question, then answers it with an experiment's results. What is the function of the question?", choices: ["It introduces the issue the paragraph addresses.", "It disproves the experiment.", "It tells a personal story.", "It lists sources."], correct: 0 },
  { section: "RW", domain: "expression", skill: "Transitions", prompt: "The trail was steep. ___, most hikers reached the top before noon. Which transition fits best?", choices: ["Therefore", "Even so", "For example", "Similarly"], correct: 1 },
  { section: "RW", domain: "expression", skill: "Rhetorical synthesis", prompt: "A student wants to stress how quickly the project was finished. Which sentence does that best?", choices: ["The project used recycled wood.", "The team finished the mural in just three days.", "The mural is on Main Street.", "Many people saw the mural."], correct: 1 },
  { section: "RW", domain: "conventions", skill: "Boundaries", prompt: "Choose the correct punctuation: \"The results were clear ___ the new method was faster.\"", choices: [",", ";", "and,", "—and"], correct: 1 },
  { section: "RW", domain: "conventions", skill: "Form, structure, and sense", prompt: "Each of the students ___ a calculator. Which verb completes the sentence?", choices: ["have", "has", "are having", "were having"], correct: 1 },
];

function guardProduction() {
  if ((process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") && !process.argv.includes("--force")) {
    console.error("Refusing to seed demo data into production. Use a local or staging database (or pass --force if you really mean it).");
    process.exit(1);
  }
}

async function removeDemo() {
  const users = await db.user.findMany({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } }, select: { id: true } });
  // Programs cascade from their admin; classes from programs.
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  return users.length;
}

async function makeUser(name: string, local: string, hash: string, extra: { timezone?: string } = {}) {
  const email = `${local}@${DEMO_DOMAIN}`;
  const u = await db.user.create({ data: { id: `demo_${local}`, name, email, emailVerified: true, timezone: extra.timezone ?? "America/New_York", lastLoginAt: new Date() } });
  await db.account.create({ data: { id: `demo_acc_${local}`, accountId: u.id, providerId: "credential", userId: u.id, password: hash } });
  return u;
}

async function main() {
  guardProduction();
  const removed = await removeDemo();
  if (process.argv.includes("--remove")) {
    console.log(`Removed ${removed} demo accounts.`);
    return;
  }
  const t0 = Date.now();
  const now = new Date();
  const start = new Date(now.getTime() - 365 * DAY);
  const hash = await hashPassword(DEMO_PASSWORD);

  const admin = await makeUser("Morgan Ellis", "admin", hash);
  const teacher = await makeUser("Priya Raman", "teacher", hash);
  const math = await makeUser("Theo Brooks", "specialist", hash);
  const tutor = await makeUser("Lena Ortiz", "tutor", hash);
  const viewer = await makeUser("Sam Carter", "viewer", hash);
  const names = new Set<string>();
  while (names.size < 30) names.add(`${pick(FIRST)} ${pick(LAST)}`);
  const students = [];
  let i = 0;
  for (const n of names) students.push(await makeUser(n, i++ === 0 ? "student" : `student${i}`, hash));

  const program = await db.program.create({
    data: { adminId: admin.id, name: "Riverside SAT Program", slug: "demo", badge: "RSP", isPublic: true, schoolAverage: 980, goalGain: 250, targets: [1200, 1300], publicBlurb: "A demo program with invented students, for trying Coursebook.", testDates: [new Date(now.getTime() + 60 * DAY), new Date(now.getTime() + 120 * DAY)], termStart: start, termEnd: new Date(now.getTime() + 90 * DAY) },
  });
  const classes = [];
  for (const [k, title] of ["SAT Prep A", "SAT Prep B"].entries()) {
    const c = await db.class.create({ data: { programId: program.id, teacherId: k === 0 ? admin.id : teacher.id, name: title, joinCode: `DEMO${k}${Math.floor(rand() * 900 + 100)}`, createdAt: start } });
    classes.push(c);
  }
  // Staff: the admin teaches A, Priya teaches B (and helps in A); Theo does Math in both; Lena tutors R&W for group 2 of A; Sam views.
  const [A, B] = classes;
  const roster = { [A.id]: students.slice(0, 16), [B.id]: students.slice(16) };
  const groups: Record<string, { id: string; members: string[] }[]> = {};
  for (const c of classes) {
    const members = roster[c.id];
    await db.classMember.createMany({ data: members.map((s) => ({ classId: c.id, userId: s.id, joinedAt: start })) });
    const half = Math.ceil(members.length / 2);
    groups[c.id] = [];
    for (const [g, slice] of [members.slice(0, half), members.slice(half)].entries()) {
      const grp = await db.classGroup.create({ data: { classId: c.id, name: `Group ${g + 1}` } });
      await db.classGroupMember.createMany({ data: slice.map((s) => ({ groupId: grp.id, userId: s.id })) });
      groups[c.id].push({ id: grp.id, members: slice.map((s) => s.id) });
    }
  }
  await db.classStaff.createMany({
    data: [
      { classId: A.id, userId: admin.id, role: "TEACHER", sections: [], domains: [], groupIds: [] },
      { classId: A.id, userId: teacher.id, role: "TEACHER", sections: [], domains: [], groupIds: [] },
      { classId: B.id, userId: teacher.id, role: "TEACHER", sections: [], domains: [], groupIds: [] },
      { classId: A.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"], domains: [], groupIds: [] },
      { classId: B.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"], domains: [], groupIds: [] },
      { classId: A.id, userId: tutor.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [groups[A.id][1].id] },
      { classId: A.id, userId: viewer.id, role: "VIEWER", sections: [], domains: [], groupIds: [] },
      { classId: B.id, userId: viewer.id, role: "VIEWER", sections: [], domains: [], groupIds: [] },
    ],
  });

  // Question bank: original items, approved and tagged.
  const ws = await db.worksheet.create({
    data: {
      ownerId: admin.id,
      title: "Demo practice bank",
      fileKey: `demo/${program.id}`,
      sizeBytes: BigInt(1),
      status: "READY",
      items: { create: QUESTIONS.map((q, n) => ({ order: n, label: String(n + 1), type: "MULTIPLE_CHOICE" as const, prompt: q.prompt, choices: q.choices, correctChoice: q.correct, answer: q.choices[q.correct], explanation: "", topic: q.skill, section: q.section, domain: q.domain, skill: q.skill, tagsConfirmed: true, approvedAt: start, approvedById: admin.id })) },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });

  // Each student has an ability that rises over the year.
  const ability = new Map(students.map((s) => [s.id, { base: clamp(normal(980, 95), 760, 1250), growth: clamp(normal(190, 90), -20, 340) }]));
  const levelAt = (id: string, t: number) => {
    const a = ability.get(id)!;
    return a.base + a.growth * clamp((t - start.getTime()) / (365 * DAY), 0, 1);
  };
  const pCorrect = (id: string, t: number) => clamp(0.25 + (levelAt(id, t) - 700) / 1100, 0.2, 0.95);

  // Scores: a PSAT baseline, then practice tests every ~2 months, and one official SAT for some.
  const scoreRows = [];
  for (const s of students) {
    const base = round10(clamp(normal(levelAt(s.id, start.getTime()), 25), 400, 1600));
    scoreRows.push({ studentId: s.id, source: "PSAT" as const, takenOn: new Date(start.getTime() + 10 * DAY), total: base, rw: round10(base / 2 + normal(0, 15)), math: 0, isBaseline: true, enteredById: s.id, verifiedById: admin.id, verifiedAt: start });
    for (let m = 2; m <= 12; m += 2 + Math.floor(rand() * 2)) {
      const t = start.getTime() + m * 30 * DAY;
      if (t > now.getTime()) break;
      const total = round10(clamp(normal(levelAt(s.id, t), 30), 400, 1600));
      scoreRows.push({ studentId: s.id, source: (m >= 10 && rand() < 0.3 ? "SAT" : "PRACTICE_BLUEBOOK") as "SAT" | "PRACTICE_BLUEBOOK", takenOn: new Date(t), total, rw: round10(total / 2 + normal(0, 15)), math: 0, isBaseline: false, enteredById: s.id });
    }
  }
  for (const r of scoreRows) r.math = clamp(r.total - r.rw, 200, 800);
  await db.scoreRecord.createMany({ data: scoreRows });
  await db.studentProfile.createMany({ data: students.map((s) => ({ userId: s.id, targetScore: pick([1200, 1200, 1300, 1400]), testDate: program.testDates[0] })) });

  // Assignments: every two weeks per class, 4 questions each; answers and mistakes follow ability.
  const answerRows = [];
  const startRows = [];
  const mistakeRows = [];
  for (const c of classes) {
    for (let w = 2; w < 52; w += 2) {
      const due = new Date(start.getTime() + w * 7 * DAY + 22 * 3600_000);
      const section = w % 4 === 0 ? "MATH" : "RW";
      const items = ws.items.filter((it) => it.section === section).sort(() => rand() - 0.5).slice(0, 4);
      const a = await db.assignment.create({ data: { classId: c.id, kind: "QUESTIONS", title: `${section === "MATH" ? "Math" : "Reading and Writing"} set ${w / 2}`, worksheetId: ws.id, itemIds: items.map((it) => it.id), section, domains: [...new Set(items.map((it) => it.domain!))], dueAt: due, createdAt: new Date(due.getTime() - 7 * DAY) } });
      if (due > now) continue;
      for (const s of roster[c.id]) {
        if (rand() < 0.12) continue; // some work is never done
        const at = new Date(due.getTime() - rand() * 5 * DAY);
        startRows.push({ assignmentId: a.id, userId: s.id, startedAt: at, submittedAt: at });
        for (const it of items) {
          const ok = rand() < pCorrect(s.id, at.getTime());
          const choice = ok ? it.correctChoice! : (it.correctChoice! + 1 + Math.floor(rand() * 3)) % 4;
          const id = `demo_ans_${a.id}_${s.id}_${it.id}`.slice(0, 120);
          answerRows.push({ id, assignmentId: a.id, itemId: it.id, userId: s.id, choice, correct: ok, score: ok ? 1 : 0, verdict: ok ? "correct" : "incorrect", gradedBy: "auto", createdAt: at });
          if (!ok) {
            const retired = rand() < 0.6 && at.getTime() < now.getTime() - 30 * DAY;
            mistakeRows.push({ studentId: s.id, sourceType: "ASSIGNMENT", sourceId: id, itemId: it.id, section: it.section, domain: it.domain, skill: it.skill, label: `${a.title}, question ${items.indexOf(it) + 1}`, due: new Date(at.getTime() + 3 * DAY), reviews: retired ? 3 : 0, streak: retired ? 2 : 0, retiredAt: retired ? new Date(at.getTime() + 20 * DAY) : null, createdAt: at });
          }
        }
      }
    }
  }
  await db.assignmentStart.createMany({ data: startRows, skipDuplicates: true });
  for (let k = 0; k < answerRows.length; k += 2000) await db.assignmentAnswer.createMany({ data: answerRows.slice(k, k + 2000) });
  await db.mistakeItem.createMany({ data: mistakeRows, skipDuplicates: true });

  // Weekly sessions with attendance.
  const attendance = [];
  for (const c of classes) {
    for (let w = 1; w < 52; w++) {
      const startsAt = new Date(start.getTime() + w * 7 * DAY + (c === A ? 1 : 3) * DAY + 21 * 3600_000);
      if (startsAt > now) break;
      const s = await db.classSession.create({ data: { classId: c.id, title: "Weekly session", startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), createdById: c.teacherId } });
      for (const st of roster[c.id]) {
        const r = rand();
        attendance.push({ sessionId: s.id, studentId: st.id, status: r < 0.84 ? "PRESENT" : r < 0.9 ? "LATE" : r < 0.95 ? "EXCUSED" : "ABSENT", markedById: c.teacherId, markedAt: startsAt });
      }
    }
    // Next few weeks, for the calendar.
    for (let w = 0; w < 4; w++) {
      const startsAt = new Date(now.getTime() + w * 7 * DAY + 2 * DAY);
      startsAt.setUTCHours(21, 0, 0, 0);
      await db.classSession.create({ data: { classId: c.id, title: "Weekly session", startsAt, endsAt: new Date(startsAt.getTime() + 90 * 60_000), createdById: c.teacherId } });
    }
  }
  await db.attendanceRecord.createMany({ data: attendance });

  // Recent study days (for streaks), a curriculum, announcements, messages.
  const days = [];
  for (const s of students) {
    const streak = Math.floor(rand() * 12);
    for (let d = 0; d < 60; d++) if (d < streak || rand() < 0.35) days.push({ userId: s.id, day: new Date(now.getTime() - d * DAY).toISOString().slice(0, 10), minutes: 10 + Math.floor(rand() * 40), questionsAnswered: 4 + Math.floor(rand() * 10), questionsCorrect: 2 + Math.floor(rand() * 6) });
  }
  await db.studyDay.createMany({ data: days, skipDuplicates: true });
  for (const c of classes) {
    await db.curriculum.create({
      data: {
        classId: c.id,
        title: "Fall plan",
        status: "ACTIVE",
        createdById: c.teacherId,
        units: { create: ["Linear equations", "Words in context", "Data and percentages", "Transitions and boundaries", "Practice test week"].map((title, n) => ({ order: n, title, domains: [], skills: [], startsOn: new Date(now.getTime() + (n * 14 - 21) * DAY), endsOn: new Date(now.getTime() + (n * 14 - 8) * DAY) })) },
      },
    });
    await db.announcement.createMany({
      data: [
        { classId: c.id, authorId: c.teacherId, title: "Practice test Saturday", body: "Full practice test in room 204 at 9am. Bring a calculator and a pencil.", pinned: true, createdAt: new Date(now.getTime() - 2 * DAY) },
        { classId: c.id, groupId: groups[c.id][0].id, authorId: c.teacherId, title: "Group 1: new Math set", body: "Your Math set is up. Aim to finish it by Thursday.", createdAt: new Date(now.getTime() - 5 * DAY) },
      ],
    });
  }
  for (const s of roster[A.id].slice(0, 5)) {
    const t = await db.messageThread.create({ data: { classId: A.id, studentId: s.id, staffId: admin.id, lastMessageAt: new Date(now.getTime() - DAY) } });
    await db.message.createMany({
      data: [
        { threadId: t.id, authorId: s.id, body: "Could we go over the last Reading and Writing set?", createdAt: new Date(now.getTime() - 2 * DAY) },
        { threadId: t.id, authorId: admin.id, body: "Yes! Bring it on Thursday and we'll look at question 3 together.", createdAt: new Date(now.getTime() - DAY) },
      ],
    });
  }
  await db.badge.createMany({ data: students.slice(0, 12).map((s) => ({ userId: s.id, kind: "STREAK_5", earnedAt: new Date(now.getTime() - 3 * DAY) })), skipDuplicates: true });

  console.log(
    [
      `Demo program "${program.name}" ready in ${((Date.now() - t0) / 1000).toFixed(1)}s:`,
      `  ${students.length} students in 2 classes, ${scoreRows.length} scores, ${answerRows.length} answers, ${attendance.length} attendance marks, ${mistakeRows.length} mistakes.`,
      `  Log in (password ${DEMO_PASSWORD}):`,
      `    admin@${DEMO_DOMAIN}   teacher@${DEMO_DOMAIN}   specialist@${DEMO_DOMAIN}   tutor@${DEMO_DOMAIN}   viewer@${DEMO_DOMAIN}   student@${DEMO_DOMAIN}`,
      `  Set DEMO_LOGINS=true to show one-click demo log-in buttons on /login.`,
    ].join("\n"),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
