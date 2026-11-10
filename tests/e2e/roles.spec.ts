import { test, expect, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { config } from "dotenv";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * One browser journey per role, each starting from nothing:
 *   Admin: signs up, creates a class, adds a Math specialist and invites a
 *     tutor, builds and assigns a diagnostic, assigns a Math set and a
 *     Reading and Writing set.
 *   Student: joins by the invite link, takes the diagnostic, completes both
 *     sets, and sees their scores.
 *   Specialist: grades the Math written answer (in scope) and can't see the
 *     Reading and Writing work, the program, or other classes.
 * Every page visited is checked with axe (WCAG 2.1 AA) in light and dark.
 */

config({ quiet: true });
const run = Date.now();
const password = "correct-horse-battery-42";
const emails = { admin: `e2e-role-admin-${run}@example.com`, math: `e2e-role-math-${run}@example.com`, student: `e2e-role-student-${run}@example.com`, tutor: `e2e-role-tutor-${run}@example.com` };

async function sql(query: string, params: unknown[] = []) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
}

const problems: string[] = [];
function watch(page: Page) {
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|create)/i.test(t)) problems.push(`[csp] ${page.url()}: ${t}`);
    else if (m.type() === "error" && !/Failed to load resource|favicon|\[HMR\]|Download the React DevTools/i.test(t)) problems.push(`[error] ${page.url()}: ${t}`);
  });
  page.on("pageerror", (e) => problems.push(`[error] ${page.url()}: ${e.message}`));
}

async function a11y(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
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
    const r = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    for (const v of r.violations) problems.push(`[a11y] ${name} (${theme}): ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 80)).join(" | ")}`);
  }
}

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
  await page.locator("main").screenshot({ path: path.join(dir, `role-${name}.png`) });
}

/**
 * Keyboard only: press Tab until the focused element matches, and check that
 * every element focused on the way shows a visible focus indicator.
 */
async function tabTo(page: Page, matches: (el: { tag: string; type: string; name: string }) => boolean, max = 120) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return null;
      const cs = getComputedStyle(a);
      const label = a.getAttribute("aria-label") || (a as HTMLInputElement).labels?.[0]?.textContent || a.textContent || "";
      const visible = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? true : cs.boxShadow !== "none" || (a.closest("label") ? getComputedStyle(a.closest("label")!).outlineStyle !== "none" : false);
      return { tag: a.tagName.toLowerCase(), type: (a as HTMLInputElement).type ?? "", name: label.replace(/\s+/g, " ").trim(), visible };
    });
    if (!el || el.tag === "body") continue; // Tab went past the page into the browser's own controls
    if (!el.visible) problems.push(`[focus] ${page.url()}: no visible focus on ${el.tag} "${el.name.slice(0, 40)}"`);
    if (matches(el)) return;
  }
  throw new Error("Couldn't reach the element with Tab");
}

/** A new account, verified, logged in, in its own browser context. */
async function account(browser: Browser, name: string, email: string, next = "/library") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page);
  // Every test account comes from 127.0.0.1, so reset the per-IP sign-up/sign-in limit (it stays on).
  await sql(`DELETE FROM "rateLimit" WHERE key LIKE '127.0.0.1%'`);
  await page.goto(`/signup?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/auth/sign-up")), page.getByRole("button", { name: "Create account" }).click()]);
  await sql(`UPDATE "user" SET "emailVerified" = true WHERE email = $1`, [email]);
  await sql(`DELETE FROM "rateLimit" WHERE key LIKE '127.0.0.1%'`);
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { ctx, page };
}

/**
 * The admin's question bank: original, tagged questions, as if uploaded and
 * checked on the Worksheets page (that flow has its own browser test).
 */
async function seedBank(ownerEmail: string) {
  const [{ id: ownerId }] = await sql(`SELECT id FROM "user" WHERE email = $1`, [ownerEmail]);
  const wsId = `ws_${randomUUID()}`;
  await sql(`INSERT INTO "Worksheet" (id, "ownerId", title, "fileKey", "sizeBytes", status, "updatedAt") VALUES ($1, $2, 'Role journey bank', $3, 1, 'READY', now())`, [wsId, ownerId, `e2e/${wsId}`]).catch(async () => {
    await sql(`INSERT INTO "Worksheet" (id, "ownerId", title, "fileKey", "sizeBytes", status) VALUES ($1, $2, 'Role journey bank', $3, 1, 'READY')`, [wsId, ownerId, `e2e/${wsId}`]);
  });
  const items: [string, string, string, string, string[] | null, number | null, string][] = [
    ["MATH", "algebra", "Linear equations in one variable", "If 2x + 4 = 10, what is x?", ["3", "4", "6", "7"], 0, "3"],
    ["MATH", "psda", "Percentages", "What is 20% of 50?", ["10", "20", "25", "5"], 0, "10"],
    ["MATH", "advanced-math", "Nonlinear functions", "If f(x) = x², what is f(3)?", ["9", "6", "3", "27"], 0, "9"],
    ["MATH", "geo-trig", "Area and volume", "A square has side 5. What is its area?", ["25", "20", "10", "15"], 0, "25"],
    ["MATH", "algebra", "Linear functions", "Explain what the slope of a line tells you.", null, null, "How much y changes for each 1 that x increases."],
    ["RW", "craft-structure", "Words in context", "\"The plan was feasible.\" Feasible most nearly means:", ["possible", "costly", "secret", "late"], 0, "possible"],
    ["RW", "expression", "Transitions", "It rained. ___, the game went on. Which fits?", ["Even so", "Therefore", "Similarly", "For instance"], 0, "Even so"],
    ["RW", "conventions", "Boundaries", "Pick the right punctuation: \"We left early ___ the roads were icy.\"", [";", ",", "and,", ":"], 0, ";"],
    ["RW", "info-ideas", "Central ideas and details", "A text describes volunteers rebuilding a park. What is its main idea?", ["A community restored a shared place.", "Parks are expensive.", "Volunteers dislike rain.", "Cities need more parks."], 0, "A community restored a shared place."],
    ["RW", "craft-structure", "Text structure and purpose", "Explain why an author might open an essay with a question.", null, null, "To introduce the issue the essay answers and draw the reader in."],
  ];
  for (const [i, [section, domain, skill, prompt, choices, correct, answer]] of items.entries()) {
    await sql(
      `INSERT INTO "WorksheetItem" (id, "worksheetId", "order", label, type, prompt, choices, "correctChoice", answer, explanation, topic, section, domain, skill, "tagsConfirmed") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10, $11, $12, $13, true)`,
      [`it_${randomUUID()}`, wsId, i, String(i + 1), choices ? "MULTIPLE_CHOICE" : "SHORT_ANSWER", prompt, choices ?? [], correct, answer, skill, section, domain, skill],
    );
  }
  return wsId;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60_000);

test("each role's journey: admin sets up, student works, specialist grades within scope", async ({ browser }) => {
  // ── Admin: a class, staff, a diagnostic and two question sets ──
  const admin = await account(browser, "Ada Admin", emails.admin, "/teach");
  const ap = admin.page;
  await ap.goto("/teach");
  await ap.getByLabel("New class name").fill("Roles Class");
  await ap.getByRole("button", { name: "Create class" }).click();
  await ap.waitForURL(/\/teach\/[^/]+\/students$/);
  const classUrl = ap.url().replace(/\/students$/, "");
  const code = (await ap.getByLabel(/^Class code /).textContent())!.trim();

  const math = await account(browser, "Milo Math", emails.math);
  await ap.goto(`${classUrl}/staff`);
  await ap.getByLabel("Email address").fill(emails.math);
  await ap.getByRole("checkbox", { name: "All of Math" }).check();
  await ap.getByRole("button", { name: "Add to staff" }).click();
  await expect(ap.getByRole("rowheader", { name: /Milo Math/ })).toBeVisible();
  // A tutor without an account yet gets an invite link.
  await ap.getByLabel("Email address").fill(emails.tutor);
  await ap.getByRole("checkbox", { name: "All of Reading and Writing" }).check();
  await ap.getByRole("button", { name: "Add to staff" }).click();
  await expect(ap.getByText(emails.tutor).first()).toBeVisible();
  await a11y(ap, "admin: staff");
  await shot(ap, "admin-staff");

  const wsId = await seedBank(emails.admin);
  await ap.goto("/teach/diagnostics");
  await ap.getByLabel("Title").fill("Roles diagnostic");
  for (const [label, v] of [["Module 1 questions", "2"], ["Module 1 minutes", "10"], ["Module 2 questions", "2"], ["Module 2 minutes", "10"]]) await ap.getByLabel(label).fill(v);
  await ap.getByRole("button", { name: "Build diagnostic" }).click();
  await ap.waitForURL(/\/teach\/diagnostics\/[^/]+$/);
  await ap.getByRole("button", { name: "Publish" }).click();
  await expect(ap.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await a11y(ap, "admin: diagnostic");
  await ap.goto(`${classUrl}/assign`);
  await ap.getByRole("button", { name: "Assign diagnostic" }).click();
  await expect(ap.getByText(/Assigned/).first()).toBeVisible();

  for (const [title, range] of [["Math set", "1, 5"], ["Words set", "6, 10"]]) {
    await ap.goto(`/teach/worksheets/${wsId}`);
    await ap.getByLabel("Pick by number").fill(range);
    await ap.getByRole("button", { name: "Select", exact: true }).click();
    await ap.getByLabel("Assignment title").fill(title);
    await ap.getByRole("button", { name: "Assign 2 questions" }).click();
    await expect(ap.getByText(/Assigned to 1 class/)).toBeVisible();
  }
  await a11y(ap, "admin: worksheet");

  // Keyboard only: the admin posts an announcement.
  await ap.goto(`${classUrl}/announcements`);
  await tabTo(ap, (e) => e.tag === "input" && e.name.startsWith("Title"));
  await ap.keyboard.type("Welcome to Roles Class");
  await tabTo(ap, (e) => e.tag === "textarea");
  await ap.keyboard.type("Sessions are on Tuesdays.");
  await tabTo(ap, (e) => e.tag === "button" && e.name === "Post announcement");
  await ap.keyboard.press("Enter");
  await expect(ap.getByRole("heading", { name: "Welcome to Roles Class" })).toBeVisible();

  // ── Student: joins by invite link, takes the diagnostic, completes both sets, sees scores ──
  const student = await account(browser, "Sol Student", emails.student, `/join/${code}`);
  const sp = student.page;
  await sp.waitForURL(new RegExp(`/join/${code}$`));
  await sp.getByRole("button", { name: "Join Roles Class" }).click();
  await sp.waitForURL(/\/classes$/);
  await a11y(sp, "student: classes");
  await sp.getByRole("link", { name: /^Start Roles diagnostic$/ }).click();
  await sp.waitForURL(/\/classes\/assignments\//);
  sp.on("dialog", (d) => void d.accept());
  await sp.getByRole("button", { name: "Start the diagnostic" }).click();
  // Two sections, two modules each: pick the first choice everywhere (the bank's right answers), hand in.
  for (let m = 0; m < 4; m++) {
    await expect(sp.getByRole("button", { name: "Hand in this module" })).toBeVisible();
    if (m === 0) await a11y(sp, "student: diagnostic module");
    const groups = sp.getByRole("group", { name: /Choices for question/ });
    for (let q = 0; q < (await groups.count()); q++) {
      await groups.nth(q).getByRole("radio").first().check();
      await sp.waitForTimeout(150);
    }
    await sp.getByRole("button", { name: "Hand in this module" }).click();
    await sp.waitForLoadState("networkidle").catch(() => {});
  }
  await expect(sp.getByRole("heading", { name: "Your estimated scores" })).toBeVisible();
  await a11y(sp, "student: diagnostic results");
  await shot(sp, "student-diagnostic");

  for (const set of ["Math set", "Words set"]) {
    if (set === "Words set") {
      // Keyboard only, start to finish.
      await sp.goto("/classes");
      await tabTo(sp, (e) => e.tag === "a" && e.name === `Start ${set}`);
      await sp.keyboard.press("Enter");
      await sp.waitForURL(/\/classes\/assignments\//);
      await tabTo(sp, (e) => e.type === "radio");
      await sp.keyboard.press("Space");
      await tabTo(sp, (e) => e.tag === "button" && e.name === "Check answer");
      await sp.keyboard.press("Enter");
      await expect(sp.getByText("Correct", { exact: true })).toBeVisible();
      // Focus lands on the feedback, not back at the top of the page.
      await expect.poll(() => sp.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("status");
      await tabTo(sp, (e) => e.tag === "textarea" || (e.tag === "input" && e.type === "text"));
      await sp.keyboard.type("It gets the reader curious and sets up the topic.");
      await tabTo(sp, (e) => e.tag === "button" && e.name === "Check answer");
      await sp.keyboard.press("Enter");
      await expect(sp.getByText("2 of 2 answered")).toBeVisible();
      continue;
    }
    await sp.goto("/classes");
    await sp.getByRole("link", { name: new RegExp(`^(Start|Continue) ${set}$`) }).click();
    await sp.waitForURL(/\/classes\/assignments\//);
    await sp.getByRole("radio").first().check({ force: true }); // the radio is visually hidden inside its label
    await sp.getByRole("button", { name: "Check answer" }).first().click();
    await expect(sp.getByText("Correct", { exact: true })).toBeVisible();
    await sp.getByLabel("Your answer to question 2").fill(set === "Math set" ? "It's how much y goes up when x goes up by 1." : "It gets the reader curious and sets up the topic.");
    await sp.getByRole("button", { name: "Check answer" }).click();
    await expect(sp.getByText("2 of 2 answered")).toBeVisible();
  }
  await a11y(sp, "student: question set");
  await sp.goto("/scores");
  await expect(sp.getByText("Diagnostic", { exact: false }).first()).toBeVisible();
  await expect(sp.getByText("Baseline", { exact: true }).first()).toBeVisible();
  await a11y(sp, "student: scores");
  await sp.goto("/dashboard");
  await expect(sp.getByRole("heading", { name: "Welcome to Roles Class" })).toBeVisible();
  await shot(sp, "student-scores");

  // ── Specialist (Math): grades in scope only ──
  const mp = math.page;
  await mp.goto(`${classUrl}/review`);
  await expect(mp.getByText(/Sol Student · Math set/)).toBeVisible();
  await expect(mp.getByText(/Words set/)).toHaveCount(0);
  await a11y(mp, "specialist: review");
  await shot(mp, "specialist-review");
  await mp.getByRole("button", { name: "Confirm grade" }).click();
  await expect(mp.getByRole("heading", { name: "Nothing to review" })).toBeVisible();
  await mp.goto(classUrl);
  await expect(mp.getByRole("link", { name: "Math set" })).toBeVisible();
  await expect(mp.getByRole("link", { name: "Words set" })).toHaveCount(0);
  const [{ id: wordsId }] = await sql(`SELECT a.id FROM "Assignment" a JOIN "Class" c ON c.id = a."classId" WHERE c."joinCode" = $1 AND a.title = 'Words set'`, [code]);
  // Out of scope reads as "not found". (With a loading screen the page streams, so the status can be 200; the content is what matters.)
  await mp.goto(`${classUrl}/assignments/${wordsId}`);
  await expect(mp.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(mp.getByText(/feasible|Explain why an author/)).toHaveCount(0);
  const [{ id: programId }] = await sql(`SELECT "programId" AS id FROM "Class" WHERE "joinCode" = $1`, [code]);
  await mp.goto(`/teach/programs/${programId}`);
  await expect(mp.getByText(/Only the program admin/)).toBeVisible();
  await mp.goto(`/teach/programs/${programId}/dashboard`);
  await expect(mp.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(mp.getByText(/Sol Student/)).toHaveCount(0);
  // The student's Words answer still waits for an R&W reviewer, not the Math specialist.
  await ap.goto(`${classUrl}/review`);
  await expect(ap.getByText(/Sol Student · Words set/)).toBeVisible();

  for (const c of [admin.ctx, math.ctx, student.ctx]) await c.close();
  await sql(`DELETE FROM "user" WHERE email = ANY($1)`, [Object.values(emails)]);
  expect(problems, `Problems found:\n${problems.join("\n")}`).toEqual([]);
});
