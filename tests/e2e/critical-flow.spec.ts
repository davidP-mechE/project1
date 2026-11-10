import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { config } from "dotenv";
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { LECTURE, makePptx } from "../helpers/slides";

/** With E2E_SHOTS=<folder>, full-page screenshots of the new pages are saved there (light mode). */
async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  });
  await page.waitForTimeout(300);
  await page.locator("main").screenshot({ path: path.join(dir, `${name}.png`) });
}

/** A small worksheet PDF: numbered questions, one with lettered choices. */
async function worksheetPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines = ["Week 3 practice: linear equations", "1. If 3x + 5 = 20, what is the value of x?", "A) 5", "B) 3", "C) 15", "D) 25", "2. Explain what a slope of 2 means for a line."];
  lines.forEach((l, i) => page.drawText(l, { x: 60, y: 720 - i * 28, size: 13, font }));
  const file = path.join(os.tmpdir(), `e2e-worksheet-${Date.now()}.pdf`);
  writeFileSync(file, await doc.save());
  return file;
}

/**
 * The journey that must never break: sign up → upload a textbook → it's read
 * → generate the course (demo mode) → study a lesson → answer questions →
 * take a unit test → review → dashboard → export → settings → admin.
 *
 * Every page is also checked for accessibility problems (axe, WCAG 2.1 AA)
 * and for anything the Content-Security-Policy blocked.
 */

config({ quiet: true });
const email = `e2e-${Date.now()}@example.com`;
const password = "correct-horse-battery-42";

async function sql(query: string, params: unknown[] = []) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
}

type Problem = { page: string; kind: "a11y" | "csp" | "error"; detail: string };
const problems: Problem[] = [];

/** Watches the browser console for CSP violations and script errors. */
function watch(page: Page) {
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|create)/i.test(t)) problems.push({ page: page.url(), kind: "csp", detail: t.slice(0, 300) });
    else if (m.type() === "error" && !/Failed to load resource|favicon|\[HMR\]|Download the React DevTools/i.test(t)) problems.push({ page: page.url(), kind: "error", detail: t.slice(0, 300) });
  });
  page.on("pageerror", (e) => problems.push({ page: page.url(), kind: "error", detail: String(e).slice(0, 300) }));
}

/** The dev server sometimes reloads a page right after compiling it; try again once it has settled. */
async function retryOnNavigation<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 3 || !/Execution context was destroyed|navigation/i.test(String(err))) throw err;
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
}

/** Runs axe on the current page, in light and dark themes. */
async function a11y(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400); // let entrance animations finish so contrast is measured on final colors
  for (const theme of ["light", "dark"] as const) {
    const results = await retryOnNavigation(page, async () => {
      await page.evaluate((t) => {
        // No transitions or animations, so colors are measured as they finally appear.
        if (!document.getElementById("e2e-still")) {
          const style = document.createElement("style");
          style.id = "e2e-still";
          style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
          document.head.append(style);
        }
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add(t);
        document.documentElement.style.colorScheme = t;
      }, theme);
      // @axe-core/playwright is typed against its own copy of Playwright; the page is the same object.
      return new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    });
    for (const v of results.violations) {
      problems.push({
        page: `${name} (${theme})`,
        kind: "a11y",
        detail: `${v.id} [${v.impact}]: ${v.help} — ${v.nodes
          .slice(0, 3)
          .map((n) => {
            const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
            const text = n.html.replace(/\s+/g, " ").slice(0, 90);
            return d?.contrastRatio ? `${text} (${d.fgColor} on ${d.bgColor} = ${d.contrastRatio})` : `${n.target.join(" ")} ${text}`;
          })
          .join(" | ")}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3} more)` : ""}`,
      });
    }
  }
}

test.describe.configure({ mode: "serial" });

test("the full student journey works, is accessible, and respects the CSP", async ({ page, context }) => {
  watch(page);

  // ── Public pages ──
  await page.goto("/");
  await a11y(page, "landing");
  for (const p of ["/terms", "/privacy", "/copyright"]) {
    await page.goto(p);
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
    await a11y(page, p);
  }

  // ── Sign up, verify (directly in the database), log in ──
  await page.goto("/signup");
  await a11y(page, "signup");
  await page.getByLabel("Name").fill("Alex Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/sign-up")), page.getByRole("button", { name: "Create account" }).click()]);
  await sql(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [email]);
  await page.goto("/login");
  await a11y(page, "login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/library/);
  await a11y(page, "library (empty)");

  // ── Upload a textbook and wait for it to be read ──
  await page.goto("/library/upload");
  await a11y(page, "upload");
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/outlined.pdf");
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await page.waitForURL(/\/courses\/[^/]+$/, { timeout: 60_000 });
  const courseUrl = page.url();
  const generate = page.getByRole("button", { name: "Generate course" }).first();
  await expect(generate).toBeVisible({ timeout: 120_000 });
  await a11y(page, "course (outline ready)");

  await page.goto(`${courseUrl}/outline`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await a11y(page, "outline editor");
  await page.goto(courseUrl);

  // ── Generate (demo mode) and wait for lessons, unit tests and the final exam ──
  await page.getByRole("button", { name: "Generate course" }).first().click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(async () => {
    await page.reload();
    expect(await page.getByText(/Writing…|Waiting/).count()).toBe(0);
    expect(await page.getByRole("link", { name: /Final exam/ }).count()).toBeGreaterThan(0);
  }).toPass({ timeout: 180_000, intervals: [3000] });
  await a11y(page, "course (generated)");

  // ── Study the first lesson ──
  await page.getByRole("link", { name: /Continue|Start/ }).first().click();
  await page.waitForURL(/\/lessons\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await a11y(page, "lesson");
  const mcq = page.locator("fieldset").first();
  if (await mcq.count()) {
    await mcq.locator("label").first().click();
    await page.getByRole("button", { name: "Check answer" }).first().click();
    await expect(page.getByText(/Correct|Not quite|Partly/).first()).toBeVisible();
  }
  await page.getByRole("button", { name: /Mark as complete|Complete and continue/ }).first().click();
  await page.waitForTimeout(800);

  // ── A unit test ──
  await page.goto(courseUrl);
  await page.locator('a:has-text("Unit test")').first().click();
  await page.waitForURL(/units\//);
  await a11y(page, "unit page");
  await page.getByRole("link", { name: /Start the unit test/ }).click();
  await page.waitForURL(/\/test$/);
  await expect(page.getByText("Question 1 of")).toBeVisible();
  await a11y(page, "unit test");
  const sets = page.locator("fieldset");
  for (let i = 0; i < (await sets.count()); i++) await sets.nth(i).locator("label").first().click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Submit test" }).first().click();
  await expect(page.getByRole("heading", { name: /% ·/ })).toBeVisible({ timeout: 60_000 });
  await a11y(page, "test results");

  // ── Practice: mastery per lesson, and a practice set that brings misses back ──
  await page.goto(`${courseUrl}/practice`);
  await expect(page.getByRole("heading", { name: /% mastered/ })).toBeVisible();
  await a11y(page, "practice");
  await page.getByRole("link", { name: "Start a practice set" }).click();
  await page.waitForURL(/practice\/session/);
  await expect(page.getByText(/of \d+ done/)).toBeVisible();
  const choice = page.locator("fieldset label").first();
  if (await choice.count()) await choice.click();
  else await page.locator("textarea").first().fill("Charge is a property of matter.");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("button", { name: /Next question|Finish/ })).toBeEnabled();
  await a11y(page, "practice session");

  // ── Everything else a student uses ──
  for (const [path, name] of [
    [`${courseUrl}/flashcards`, "course flashcards"],
    [`${courseUrl}/search?q=charge`, "search"],
    [`${courseUrl}/notes`, "notes"],
    [`${courseUrl}/plan`, "study plan"],
    [`${courseUrl}/setup`, "course settings"],
    [`${courseUrl}/tutor`, "tutor"],
    [`${courseUrl}/export`, "export"],
    [`${courseUrl}/final-exam`, "final exam"],
    ["/review", "spaced repetition"],
    ["/errors", "error log"],
    ["/skills", "review (skills)"],
    ["/mastery", "mastery"],
    ["/hub", "hub (empty)"],
    ["/dashboard", "dashboard"],
    ["/library", "library"],
    ["/settings", "settings"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBeLessThan(400);
    await a11y(page, name);
  }
  await expect(page.getByRole("heading", { name: "Plan and usage" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Pages turned into lessons this month" })).toBeVisible();

  // ── Review: hammer a skill (new questions are written when they run low) ──
  await page.goto("/skills");
  await page.getByRole("link", { name: /Hammer it/ }).first().click();
  await page.waitForURL(/skills\/drill/);
  await expect(page.getByText(/right in a row/).first()).toBeVisible();
  const drillChoice = page.locator("fieldset label").first();
  if (await drillChoice.count()) await drillChoice.click();
  else await page.locator("textarea").first().fill("The rate of flow of charge.");
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByRole("button", { name: "Next question →" })).toBeEnabled();
  await a11y(page, "review drill");

  // ── Downloads ──
  await page.goto(`${courseUrl}/export`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download .apkg" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.apkg$/);

  // ── Lecture slides: a PowerPoint deck becomes a mini-course ──
  const deckFile = path.join(os.tmpdir(), `e2e-lecture-${Date.now()}.pptx`);
  writeFileSync(deckFile, makePptx(LECTURE));
  await page.goto("/slides");
  await a11y(page, "slides (empty)");
  await page.goto("/slides/upload");
  await a11y(page, "upload slides");
  await page.locator('input[type="file"]').setInputFiles(deckFile);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await page.waitForURL(/\/courses\/[^/]+$/, { timeout: 60_000 });
  const deckUrl = page.url();
  await expect(page.getByRole("button", { name: "Generate course" }).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("from the slide titles and section slides")).toBeVisible();
  await page.getByRole("button", { name: "Generate course" }).first().click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(async () => {
    await page.reload();
    expect(await page.getByText(/Writing…|Waiting/).count()).toBe(0);
    expect(await page.getByRole("link", { name: /Final exam/ }).count()).toBeGreaterThan(0);
  }).toPass({ timeout: 180_000, intervals: [3000] });
  await page.getByRole("link", { name: /Continue|Start/ }).first().click();
  await page.waitForURL(/\/lessons\//);
  await expect(page.getByText(/Slides \d+–\d+/).first()).toBeVisible();
  await page.getByRole("button", { name: "See the slides" }).click();
  await expect(page.getByRole("region", { name: "Original slides" }).or(page.getByLabel("Original slides"))).toBeVisible({ timeout: 30_000 });
  await a11y(page, "slide lesson");
  await page.goto("/slides");
  await expect(page.getByRole("link", { name: /e2e lecture/i }).first()).toBeVisible();
  await a11y(page, "slides");
  await page.goto("/library");
  await expect(page.getByText(/e2e lecture/i)).toHaveCount(0); // decks are not listed with books

  // ── Slide collage: more decks under the same course ──
  const week2 = path.join(os.tmpdir(), `e2e-week2-${Date.now()}.pptx`);
  writeFileSync(week2, makePptx([{ title: "Week 2 review" }, { title: "Series circuits", body: ["Resistances in series add up", "The same current flows through each one"] }, { title: "Parallel circuits", body: ["Branch currents add up to the total", "Each branch has the same voltage"] }, { title: "Questions?" }]));
  await page.goto(deckUrl);
  await expect(page.getByRole("heading", { name: "Slide decks" })).toBeVisible();
  await page.getByRole("button", { name: "Add slides" }).click();
  await page.getByLabel("Slide decks to add (PDF or PowerPoint)").setInputFiles(week2);
  await page.getByRole("list", { name: "Decks, in course order" }).waitFor();
  await a11y(page, "add slides");
  await page.getByRole("checkbox", { name: /my own slides/ }).check();
  await page.getByRole("button", { name: "Add deck" }).click();
  await expect(page.getByText("Adding your slides…")).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("slides 12–15")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 120_000, intervals: [3000] });
  await expect(page.getByRole("button", { name: /Generate 1 remaining/ })).toBeVisible(); // the new deck's lessons, ready to write
  await a11y(page, "course with two decks");

  // Several decks at once become one course.
  await page.goto("/slides/upload");
  await page.locator('input[type="file"]').setInputFiles([deckFile, week2]);
  await page.getByLabel("Course name").fill("E2E collage");
  await page.getByRole("button", { name: `Move ${path.basename(week2)} up` }).click(); // week 2 first
  await a11y(page, "upload a collage");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Upload 2 decks as one course" }).click();
  await page.waitForURL(/\/courses\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Generate course" }).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "E2E collage" })).toBeVisible();
  await expect(page.getByText("slides 1–4")).toBeVisible();
  await expect(page.getByText("slides 5–15")).toBeVisible();

  // ── Keyboard: the first Tab reaches "Skip to content", which moves focus past the header ──
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  // ── Security headers ──
  const res = await page.goto("/dashboard");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(res?.headers()["x-content-type-options"]).toBe("nosniff");

  // ── Admin: hidden from students, available to admins ──
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await sql(`UPDATE "user" SET role = 'ADMIN' WHERE email = $1`, [email]);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();
  await a11y(page, "admin");

  // ── Hub: an admin publishes a course; then it can be added to a library ──
  await page.goto(courseUrl);
  await page.getByLabel("Description").fill("A short demo course about circuits.");
  await page.getByRole("button", { name: "Publish to the Hub" }).click();
  await expect(page.getByText("Published to the Hub.")).toBeVisible({ timeout: 60_000 });
  await page.goto("/hub");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await a11y(page, "hub");
  await page.getByRole("button", { name: /Add to my library/ }).first().click();
  await page.waitForURL(/\/courses\/[^/]+$/, { timeout: 60_000 });
  expect(page.url()).not.toBe(courseUrl);
  await expect(page.getByRole("heading", { name: "Credits" })).toBeVisible();

  // ── Classes: a teacher assigns a worksheet and lessons; a student joins, answers; the teacher sees it ──
  await page.goto("/teach");
  await a11y(page, "teach (empty)");
  await page.getByLabel("New class name").fill("SAT Math, Period 2");
  await page.getByRole("button", { name: "Create class" }).click();
  await page.waitForURL(/\/teach\/[^/]+\/students$/);
  const classUrl = page.url().replace(/\/students$/, "");
  const code = (await page.getByLabel(/^Class code /).textContent())!.trim();
  await page.goto("/teach");
  await shot(page, "my-classes");
  await page.goto(`${classUrl}/students`);
  await a11y(page, "class students");
  await shot(page, "class-students");

  await page.goto("/teach/worksheets");
  await a11y(page, "worksheets");
  await shot(page, "worksheets");
  await page.getByLabel("Worksheet PDF").setInputFiles(await worksheetPdf());
  await page.getByRole("checkbox", { name: /I wrote this worksheet/ }).check();
  await page.getByRole("button", { name: "Upload and read questions" }).click();
  await page.waitForURL(/\/teach\/worksheets\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Assign questions" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("2 questions from 1 page")).toBeVisible();
  await page.getByRole("button", { name: "Confirm all 2 suggested tags" }).click();
  await expect(page.getByText("Suggested by Claude")).toHaveCount(0);
  await a11y(page, "worksheet");
  await shot(page, "worksheet-review");
  await page.getByLabel("Assignment title").fill("Week 3 homework");
  await page.getByRole("button", { name: "Assign 2 questions" }).click();
  await expect(page.getByText(/Assigned to 1 class/)).toBeVisible();

  await page.goto(`${classUrl}/assign`);
  await page.getByRole("checkbox", { name: "The whole course" }).check();
  await a11y(page, "assign lessons");
  await shot(page, "assign-lessons");
  await page.getByRole("button", { name: "Assign the course" }).click();
  await page.waitForURL(new RegExp(`${classUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

  // A student signs up from the invite link and lands back on it.
  const studentEmail = `e2e-student-${Date.now()}@example.com`;
  const sctx = await context.browser()!.newContext();
  const sp = await sctx.newPage();
  watch(sp);
  await sp.goto(`/join/${code}`);
  await expect(sp.getByRole("heading", { name: "Join SAT Math, Period 2" })).toBeVisible();
  await a11y(sp, "join (logged out)");
  await shot(sp, "join-link");
  await sp.getByRole("link", { name: "Create an account" }).click();
  await sp.getByLabel("Name").fill("Sam Student");
  await sp.getByLabel("Email").fill(studentEmail);
  await sp.getByLabel("Password", { exact: true }).fill(password);
  await sp.getByLabel("Confirm password").fill(password);
  await Promise.all([sp.waitForResponse((r) => r.url().includes("/api/auth/sign-up")), sp.getByRole("button", { name: "Create account" }).click()]);
  await sql(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [studentEmail]);
  await sp.goto(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  await sp.getByLabel("Email").fill(studentEmail);
  await sp.getByLabel("Password").fill(password);
  await sp.getByRole("button", { name: "Log in" }).click();
  await sp.waitForURL(new RegExp(`/join/${code}$`));
  await sp.getByRole("button", { name: "Join SAT Math, Period 2" }).click();
  await sp.waitForURL(/\/classes$/);
  await expect(sp.getByRole("heading", { name: "SAT Math, Period 2" })).toBeVisible();
  await a11y(sp, "classes (student)");
  await shot(sp, "student-classes");

  await sp.getByRole("link", { name: "Start" }).first().click();
  await sp.waitForURL(/\/classes\/assignments\//);
  await sp.getByText("5", { exact: true }).click(); // choice A) 5 (the demo answer key marks the first choice right)
  await sp.getByRole("button", { name: "Check answer" }).first().click();
  await expect(sp.getByText("Correct", { exact: true })).toBeVisible();
  await sp.getByLabel("Your answer to question 2").fill("The line goes up 2 for every 1 to the right.");
  await sp.getByRole("button", { name: "Check answer" }).click();
  await expect(sp.getByText("2 of 2 answered")).toBeVisible();
  await a11y(sp, "question set");
  await shot(sp, "student-question-set");
  await sp.goto("/dashboard");
  await expect(sp.getByRole("heading", { name: "Assigned to you" })).toBeVisible(); // the course is still to do
  await shot(sp, "dashboard-assigned");
  await sp.goto("/classes");
  await sp.getByRole("button", { name: "Start" }).click(); // the assigned course: makes the student's own copy
  await sp.waitForURL(/\/courses\/[^/]+\/lessons\//, { timeout: 60_000 });
  await sctx.close();

  // The teacher sees it.
  await page.goto(classUrl);
  await expect(page.getByRole("rowheader", { name: "Sam Student" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /\d+%/ }).first()).toBeVisible();
  await a11y(page, "class progress");
  await shot(page, "class-progress");
  await page.getByRole("link", { name: "Week 3 homework" }).click();
  await expect(page.getByRole("heading", { name: "By question" })).toBeVisible();
  await a11y(page, "assignment report");
  await shot(page, "assignment-report");
  await page.goto(`${classUrl}/skills`);
  await a11y(page, "class skills");
  await shot(page, "class-skills");

  // ── Staff: groups, a Math specialist, reviewing AI grades, the program page ──
  await page.goto(`${classUrl}/groups`);
  await page.getByLabel("Group name").fill("Tuesday session");
  await page.getByRole("checkbox", { name: "Sam Student" }).check();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("button", { name: "Save group" })).toBeVisible();
  await a11y(page, "class groups");
  await shot(page, "class-groups");

  const specEmail = `e2e-spec-${Date.now()}@example.com`;
  const xctx = await context.browser()!.newContext();
  const xp = await xctx.newPage();
  watch(xp);
  await xp.goto("/signup");
  await xp.getByLabel("Name").fill("Maya Math");
  await xp.getByLabel("Email").fill(specEmail);
  await xp.getByLabel("Password", { exact: true }).fill(password);
  await xp.getByLabel("Confirm password").fill(password);
  await Promise.all([xp.waitForResponse((r) => r.url().includes("/api/auth/sign-up")), xp.getByRole("button", { name: "Create account" }).click()]);
  await sql(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [specEmail]);
  await xp.goto("/login");
  await xp.getByLabel("Email").fill(specEmail);
  await xp.getByLabel("Password").fill(password);
  await xp.getByRole("button", { name: "Log in" }).click();
  await xp.waitForURL(/library/);

  await page.goto(`${classUrl}/staff`);
  await page.getByLabel("Email address").fill(specEmail);
  await page.getByRole("checkbox", { name: "All of Math" }).check();
  await page.getByRole("button", { name: "Add to staff" }).click();
  await expect(page.getByText(`Added ${specEmail}`)).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Maya Math/ })).toBeVisible();
  await a11y(page, "class staff");
  await shot(page, "class-staff");

  await xp.goto("/teach");
  await xp.getByRole("link", { name: /SAT Math, Period 2/ }).click();
  await expect(xp.getByText(/You: Specialist/)).toBeVisible();
  await expect(xp.getByRole("link", { name: "Week 3 homework" })).toBeVisible(); // tagged Algebra, so in a Math specialist's scope
  await a11y(xp, "specialist class view");
  await shot(xp, "specialist-view");
  await xctx.close();

  await page.goto(`${classUrl}/review`);
  await expect(page.getByText(/Sam Student · Week 3 homework/)).toBeVisible();
  await a11y(page, "review AI grades");
  await shot(page, "review-ai-grades");
  await page.getByRole("button", { name: "Confirm grade" }).click();
  await expect(page.getByRole("heading", { name: "Nothing to review" })).toBeVisible();

  await page.goto("/teach");
  await page.getByRole("link", { name: /tutoring program/ }).click();
  await page.waitForURL(/\/teach\/programs\//);
  const programUrl = page.url();
  await expect(page.getByText(/Added Maya Math to SAT Math, Period 2 as Specialist \(Math\)/)).toBeVisible();
  await a11y(page, "program");
  await shot(page, "program");

  // ── Phone width: no sideways scrolling on the main pages ──
  const phone = await context.browser()!.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const p2 = await phone.newPage();
  watch(p2);
  for (const url of ["/dashboard", courseUrl, `${courseUrl}/export`, `${courseUrl}/practice`, deckUrl, "/slides", "/skills", "/errors", "/mastery", "/hub", "/review", "/settings", "/admin", "/privacy", "/teach", classUrl, `${classUrl}/students`, `${classUrl}/staff`, `${classUrl}/groups`, `${classUrl}/review`, programUrl, "/teach/worksheets", "/classes"]) {
    await p2.goto(url);
    await p2.waitForLoadState("networkidle").catch(() => {});
    expect(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no sideways scroll on ${url}`).toBe(true);
  }
  // The phone menu opens and closes.
  await p2.goto("/dashboard");
  await p2.getByRole("button", { name: "Open menu" }).click();
  await expect(p2.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await a11y(p2, "phone menu");
  await p2.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Slides" }).click();
  await p2.waitForURL(/\/slides$/);
  await expect(p2.getByRole("dialog", { name: "Menu" })).toBeHidden();
  await phone.close();

  // Clean up the test account.
  await sql(`DELETE FROM "user" WHERE email = ANY($1)`, [[email, specEmail]]);

  const report = problems.map((p) => `[${p.kind}] ${p.page}: ${p.detail}`).join("\n");
  expect(problems, `Problems found:\n${report}`).toEqual([]);
});
