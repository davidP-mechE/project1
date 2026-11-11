/**
 * Times the heavy pages' server work against the demo program (npm run seed:demo first).
 * Usage: npm run perf:check
 */
import { db } from "../src/server/db";
import { classScores, programDashboard, myScores } from "../src/server/scores";
import { classTrends, programTrends } from "../src/server/trends";
import { calendarEvents } from "../src/server/calendar";
import { classAlerts } from "../src/server/cohort";
import { classProgress, skillsReport, myClasses } from "../src/server/classes";
import { listThreads } from "../src/server/messages";
import { getDashboard } from "../src/server/dashboard";
import { classSummaryReport, myProgressReport } from "../src/server/reports";
import { awardBadges } from "../src/server/badges";
import { refreshStaffNotices } from "../src/server/notifications";

/** Runs it twice and reports the second (warm) run: the first includes loading code. */
async function time(label: string, fn: () => Promise<unknown>) {
  await fn();
  const t = performance.now();
  await fn();
  const ms = performance.now() - t;
  console.log(`${ms > 500 ? "SLOW" : "ok  "} ${ms.toFixed(0).padStart(6)} ms  ${label}`);
  return ms;
}

async function main() {
  process.env.STAFF_TWO_FACTOR = "off";
  const program = await db.program.findFirst({ where: { slug: "demo" }, include: { classes: true } });
  if (!program) throw new Error("Run npm run seed:demo first.");
  const admin = program.adminId;
  const [A] = program.classes;
  const student = "demo_student";
  const now = new Date();
  const month = (k: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
  await time("class scores", () => classScores(admin, A.id));
  await time("class progress", () => classProgress(admin, A.id));
  await time("skills report", () => skillsReport(admin, A.id));
  await time("class alerts", () => classAlerts(admin, A.id));
  await time("class trends", () => classTrends(admin, A.id));
  await time("class summary report", () => classSummaryReport(admin, A.id));
  await time("program dashboard", () => programDashboard(admin, program.id));
  await time("program trends", () => programTrends(admin, program.id));
  await time("calendar (staff, month)", () => calendarEvents(admin, month(-1), month(1)));
  await time("calendar (student, month)", () => calendarEvents(student, month(-1), month(1)));
  await time("messages (program)", () => listThreads(admin, { view: "program" }));
  await time("student Today", () => getDashboard(student));
  await time("student classes", () => myClasses(student));
  await time("student scores", () => myScores(student));
  await time("student report", () => myProgressReport(student));
  await time("award badges", () => awardBadges(student));
  await time("hourly staff notices (all)", () => refreshStaffNotices());
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
