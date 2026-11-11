import { test, expect, type Browser, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Client } from "pg";
import { hashPassword } from "better-auth/crypto";

/**
 * Phase 3b acceptance checks in a real browser, at phone width (400px):
 *   - the practice player shows a wrong choice's likely mistake and accepts 0.75 for 3/4
 *   - the calculator keeps its graph between questions, starts blank for a new
 *     set, and is hidden on a by-hand assignment; a failed Desmos script shows the fallback link
 *   - logging a full 98-question test with 12 misses (counted in taps and seconds)
 *   - /studio, a draft course and a draft file are 404 for a signed-out visitor,
 *     a student and a tutor (pages and API routes), and drafts aren't in the catalog
 *   - a tutor can't load a student outside their classes (API)
 * Desmos itself isn't contacted: a small stand-in script answers for desmos.com.
 */

config({ quiet: true });
const run = Date.now();
const password = "correct-horse-battery-42";
const OWNER = process.env.E2E_OWNER_EMAIL ?? "e2e-owner@example.com";
const email = (who: string) => `e2e-3b-${who}-${run}@example.com`;
const ids: Record<string, string> = {};

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows as T[];
  } finally {
    await db.end();
  }
}

async function user(id: string, name: string, mail: string, role = "USER") {
  const hash = await hashPassword(password);
  await sql(`INSERT INTO "user"(id, name, email, "emailVerified", role, "updatedAt") VALUES ($1,$2,$3,true,$4,now()) ON CONFLICT (email) DO UPDATE SET "emailVerified" = true`, [id, name, mail, role]);
  const [{ id: uid }] = await sql<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [mail]);
  await sql(`INSERT INTO account(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1,$2,'credential',$2,$3,now(),now()) ON CONFLICT (id) DO UPDATE SET password = $3`, [`acc_${uid}`, uid, hash]);
  return uid;
}

const FAKE_DESMOS = `window.Desmos = { GraphingCalculator: function (el) {
  var state = { expressions: { list: [] } }; var cbs = [];
  var input = document.createElement("input"); input.setAttribute("aria-label", "fake expression"); el.appendChild(input);
  var out = document.createElement("p"); out.className = "fake-state"; el.appendChild(out);
  function render() { out.textContent = JSON.stringify(state.expressions.list.map(function (e) { return e.latex; })); }
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { state.expressions.list.push({ latex: input.value }); input.value = ""; render(); cbs.forEach(function (c) { c(); }); } });
  render();
  return { destroy: function () { el.innerHTML = ""; }, getState: function () { return JSON.parse(JSON.stringify(state)); }, setState: function (s) { state = JSON.parse(JSON.stringify(s)); render(); }, setBlank: function () { state = { expressions: { list: [] } }; render(); }, updateSettings: function () {}, resize: function () {}, observeEvent: function (n, c) { cbs.push(c); } };
} };`;

async function phone(browser: Browser, mail: string | null, desmos: "fake" | "fail" = "fake") {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 850 }, hasTouch: true });
  await ctx.route("https://www.desmos.com/**", (r) => (desmos === "fake" ? r.fulfill({ contentType: "text/javascript", body: FAKE_DESMOS }) : r.abort()));
  const page = await ctx.newPage();
  if (mail) {
    await sql(`DELETE FROM "rateLimit"`); // many test logins from one address
    const r = await page.request.post("/api/auth/sign-in/email", { data: { email: mail, password }, headers: { Origin: "http://localhost:3100" } });
    expect(r.status(), `log in ${mail}`).toBe(200);
  }
  return page;
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await sql(`DELETE FROM "rateLimit"`);
  ids.owner = await user(`e2e3b_owner`, "E2E Owner", OWNER);
  ids.tutor = await user(`e2e3b_tutor_${run}`, "E2E Tutor", email("tutor"), "TUTOR");
  ids.student = await user(`e2e3b_student_${run}`, "E2E Student", email("student"));
  ids.outsider = await user(`e2e3b_outsider_${run}`, "E2E Outsider", email("outsider"));

  // A class taught by the tutor with the student in it.
  ids.program = `e2e3b_prog_${run}`;
  ids.class = `e2e3b_class_${run}`;
  await sql(`INSERT INTO "Program"(id, name, "adminId") VALUES ($1,'E2E Program',$2)`, [ids.program, ids.tutor]);
  await sql(`INSERT INTO "Class"(id, "programId", "teacherId", name, "joinCode") VALUES ($1,$2,$3,'E2E Class',$4)`, [ids.class, ids.program, ids.tutor, `E${String(run).slice(-6)}`]);
  await sql(`INSERT INTO "ClassMember"(id, "classId", "userId") VALUES ($1,$2,$3)`, [`e2e3b_m_${run}`, ids.class, ids.student]);

  // Two published original questions and a public set; a by-hand assignment of the same set.
  ids.mcq = `e2e3b_q1_${run}`;
  ids.grid = `e2e3b_q2_${run}`;
  await sql(
    `INSERT INTO bank_questions(id, section, skill_id, type, difficulty, stem, choices, answer, explanation, distractor_notes, status, "updatedAt") VALUES
     ($1,'math','math.algebra.linear-equations-in-one-variable','mcq',1,'If $2(x - 4) = -2$, what is $x$?',ARRAY['1','-1','-5','3'],'D','Divide by 2, then add 4.','{"A":"Didn''t distribute.","B":"Stopped early.","C":"Wrong sign."}','published',now()),
     ($2,'math','math.psda.ratios-rates-proportional-relationships-and-units','grid-in',1,'What is $3 \\div 4$?','{}','3/4','Three quarters.','{"4/3":"Flipped it."}','published',now())`,
    [ids.mcq, ids.grid],
  );
  ids.set = `e2e3b_set_${run}`;
  await sql(`INSERT INTO question_sets(id, title, question_ids, skill_ids, visibility, status, "updatedAt") VALUES ($1,$2,$3,'{}','public','published',now())`, [ids.set, `E2E set ${run}`, [ids.mcq, ids.grid]]);
  ids.byHand = `e2e3b_a_${run}`;
  await sql(`INSERT INTO "Assignment"(id, "classId", kind, title, "questionSetId", calculator) VALUES ($1,$2,'QUESTION_SET','By hand set',$3,'BY_HAND')`, [ids.byHand, ids.class, ids.set]);

  // A draft studio course with a draft file (the file never needs to exist: access is refused first).
  ids.course = `e2e3b_course_${run}`;
  ids.slug = `e2e-draft-${run}`;
  await sql(`INSERT INTO studio_courses(id, slug, title, section, "updatedAt") VALUES ($1,$2,'E2E Secret Draft','math',now())`, [ids.course, ids.slug]);
  await sql(`INSERT INTO studio_units(id, "courseId", "order", title) VALUES ($1,$2,0,'Unit')`, [`${ids.course}_u`, ids.course]);
  await sql(`INSERT INTO studio_lessons(id, "unitId", "order", title) VALUES ($1,$2,0,'Lesson')`, [`${ids.course}_l`, `${ids.course}_u`]);
  ids.file = `${ids.course}_f`;
  await sql(`INSERT INTO studio_files(id, "lessonId", name, "contentType", "sizeBytes", "storageKey") VALUES ($1,$2,'secret.pdf','application/pdf',10,'studio/none.pdf')`, [ids.file, `${ids.course}_l`]);
});

test.afterAll(async () => {
  await sql(`DELETE FROM studio_courses WHERE id = $1`, [ids.course]);
  await sql(`DELETE FROM "Program" WHERE id = $1`, [ids.program]);
  await sql(`DELETE FROM question_sets WHERE id = $1`, [ids.set]);
  await sql(`DELETE FROM bank_questions WHERE id = ANY($1)`, [[ids.mcq, ids.grid]]);
  await sql(`DELETE FROM "user" WHERE id = ANY($1)`, [[ids.tutor, ids.student, ids.outsider]]);
});

test("practice player: likely mistake, grid-in equivalence, calculator kept between questions", async ({ browser }) => {
  const page = await phone(browser, email("student"));
  await page.goto(`/practice/${ids.set}`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Question 1 of 2")).toBeVisible();
  await noSideScroll(page);

  await page.getByRole("button", { name: "Calculator" }).click();
  await page.getByLabel("fake expression").fill("y=2x");
  await page.getByLabel("fake expression").press("Enter");
  await expect(page.locator(".fake-state")).toHaveText('["y=2x"]');
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("A.").check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Likely mistake: Didn't distribute.")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Your answer").fill("0.75");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toContainText("Correct");

  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.locator(".fake-state")).toHaveText('["y=2x"]'); // same graph on the next question

  // A new sitting of a set starts with a blank calculator.
  await page.goto(`/practice/${ids.set}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.locator(".fake-state")).toHaveText("[]");
});

test("by-hand assignment hides the calculator; a failed Desmos script falls back to a link", async ({ browser }) => {
  const page = await phone(browser, email("student"), "fail");
  await page.goto(`/practice/${ids.set}?assignment=${ids.byHand}`);
  await expect(page.getByText("by hand: no calculator")).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Question 1 of 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Calculator" })).toHaveCount(0);

  await page.goto(`/practice/${ids.set}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Calculator" }).click();
  await expect(page.getByRole("link", { name: /Open the Desmos calculator/ })).toBeVisible();
});

test("logging a 98-question test with 12 misses at phone width", async ({ browser }) => {
  const page = await phone(browser, email("student"));
  await page.goto("/practice-tests/new");
  const t0 = Date.now();
  let taps = 0;
  await page.getByRole("button", { name: "Start logging" }).click();
  taps++;
  await expect(page.getByRole("tablist", { name: "Modules" })).toBeVisible();
  await page.getByLabel("R&W score").fill("640");
  await page.getByLabel("Math score").fill("700");
  taps += 2;
  const misses: [string, number[]][] = [["R&W 1", [3, 9, 17]], ["R&W 2", [5, 22, 26]], ["Math 1", [8, 15, 21]], ["Math 2", [4, 12, 20]]];
  for (const [mod, nums] of misses) {
    await page.getByRole("tab", { name: new RegExp(`^${mod}`) }).click();
    taps++;
    for (const n of nums) {
      await page.getByRole("button", { name: `Question ${n}: Correct` }).click();
      taps++;
    }
  }
  const rows = page.locator("li:has(select[aria-label^='Skill for'])");
  await expect(rows).toHaveCount(12);
  for (let i = 0; i < 12; i++) {
    const row = rows.nth(i);
    const values = await row.locator("select option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    await row.locator("select").selectOption(values[i % values.length]);
    await row.getByRole("radio").nth(i % 2).click();
    taps += 3;
  }
  await noSideScroll(page);
  await page.getByRole("button", { name: "Finish log" }).click();
  taps++;
  await page.waitForURL(/practice-tests\/insights/);
  const seconds = (Date.now() - t0) / 1000;
  console.log(`Logged 12 misses in ${taps} taps (${seconds.toFixed(1)}s automated). At ~3 s per tap that's about ${Math.round((taps * 3) / 60)} minutes for a person.`);
  expect(taps).toBeLessThanOrEqual(70); // ~3.5 minutes at 3 s per tap: inside the 5-minute bar
  const [a] = await sql<{ status: string; total: number; n: string }>(`SELECT status, total, (SELECT count(*) FROM attempt_items i WHERE i.attempt_id = a.id) AS n FROM test_attempts a WHERE user_id = $1 ORDER BY "createdAt" DESC LIMIT 1`, [ids.student]);
  expect(a).toEqual({ status: "complete", total: 1340, n: "12" });
  await expect(page.getByRole("heading", { name: "Focus next" })).toBeVisible();
  await noSideScroll(page);
});

test("/studio, draft course and draft file URLs are a plain 404 for everyone but the owner", async ({ browser }) => {
  const anon = await phone(browser, null);
  const student = await phone(browser, email("student"));
  const tutor = await phone(browser, email("tutor"));
  const owner = await phone(browser, OWNER);
  const urls = ["/studio", `/studio/courses/${ids.course}`, `/studio/courses/${ids.course}/preview`, `/learn/${ids.slug}`, `/learn/${ids.slug}/lessons/${ids.course}_l`];
  for (const [who, page] of [["signed out", anon], ["student", student], ["tutor", tutor]] as const) {
    for (const u of urls) {
      const r = await page.goto(u);
      expect(r?.status(), `${who} ${u}`).toBe(404);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    }
    for (const u of [`/api/studio/files/${ids.file}`, `/api/studio/lessons/${ids.course}_l/upload`]) {
      const r = await page.request.get(u);
      expect(r.status(), `${who} ${u}`).toBe(404);
    }
  }
  expect((await owner.goto("/studio"))?.status()).toBe(200);
  expect((await owner.goto(`/learn/${ids.slug}`))?.status()).toBe(200);

  // Never in the catalog, its search, or the JSON list.
  await student.goto(`/learn?q=Secret`);
  await expect(student.getByText("E2E Secret Draft")).toHaveCount(0);
  const list = await (await student.request.get("/api/learn/courses?q=Secret")).json();
  expect(list.courses).toEqual([]);
});

test("a tutor can't load a student outside their classes (API)", async ({ browser }) => {
  const tutor = await phone(browser, email("tutor"));
  expect((await tutor.request.get(`/api/classes/${ids.class}/students/${ids.student}/practice`)).status()).toBe(200);
  expect((await tutor.request.get(`/api/classes/${ids.class}/students/${ids.outsider}/practice`)).status()).toBe(404);
  const outsider = await phone(browser, email("outsider"));
  expect((await outsider.request.get(`/api/classes/${ids.class}/students/${ids.student}/practice`)).status()).toBe(404);
});
