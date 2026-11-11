import { formatInZone } from "@/lib/dates";
import { viewerZone } from "@/server/session";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccessRuleForm, DemoDataControls, PlanSelect, RemoveRuleButton, RetryButton, RoleSelect, TestEmailButton } from "@/components/admin/admin-controls";
import { listAccessRules } from "@/server/program-access";
import { emailStatus } from "@/server/email";
import { DEMO_MODE_DOMAIN, DEMO_MODE_PASSWORD, DEMO_TUTOR_EMAIL, demoStatus } from "@/server/demo-data";
import { Card, PageHeader } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";
import { getAiSpend, getFailures, getFeatureUsage, getOverview, listUsers, requireAdmin } from "@/server/admin";
import { listProblems } from "@/server/monitoring";
import { isOwner } from "@/server/roles";
import { DeleteAccountForm, ResolveButton } from "@/components/support/data-forms";

export const metadata: Metadata = { title: "Admin" };

const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`);
const num = (n: number) => n.toLocaleString("en-US");
const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const FEATURE_LABELS: Record<string, string> = {
  LESSON: "Lessons",
  QUESTIONS: "Regenerated questions",
  ASSESSMENT: "Unit tests and exams",
  PAGE_REPAIR: "Equation pages (vision)",
  GRADING: "Grading written answers",
  TUTOR: "Tutor",
  WORKSHEET: "Reading worksheets",
  FLASHCARDS: "Flashcards",
  CURRICULUM: "Curriculum imports",
  DRAFT: "Drafted questions and lessons",
  SUMMARY: "Weekly summaries",
  ASSISTANT: "Assistant questions",
};

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`px-4 py-2 font-medium ${i > 0 && h !== "" ? "whitespace-nowrap" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

const td = "px-4 py-2 align-top";

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const me = await requireAdmin();
  const viewerIsOwner = await isOwner(me.id);
  const zone = await viewerZone();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [overview, spend, usage, failures, users, problems, demo, access] = await Promise.all([getOverview(), getAiSpend(), getFeatureUsage(), getFailures(), listUsers(q), listProblems(), demoStatus(), listAccessRules()]);
  const mail = emailStatus();
  const maxDay = Math.max(0.01, ...spend.daily.map((d) => d.usd));
  const failedTotal = failures.books.length + failures.lessons.length + failures.assessments.length;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Admin" description="Users, Claude API spend, failed work and feature use. Only admins can see this page." />

      <Section id="problems" title="Errors and problem reports" description="Server, browser and worker errors (grouped; personal details removed), and reports from the Report a problem button. You're emailed when a new one appears.">
        {problems.errors.length === 0 && problems.reports.length === 0 ? (
          <p className="text-sm text-muted">Nothing open.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface text-sm">
            {problems.errors.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 text-xs font-semibold text-danger">{e.kind}</span> <span className="font-medium">{e.message}</span>
                  <span className="block text-xs text-muted">
                    {e.path || "–"} · {e.count}× · last {formatInZone(e.lastAt, zone, "full")} · id {e.id}
                  </span>
                </span>
                <ResolveButton kind="error" id={e.id} />
              </li>
            ))}
            {problems.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="rounded bg-warning-bg px-1.5 py-0.5 text-xs font-semibold text-warning">report</span> <span className="font-medium">{r.note || "(no note)"}</span>
                  <span className="block text-xs text-muted">
                    {r.path} · {formatInZone(r.createdAt, zone, "full")} · {r.errorIds.length ? `errors: ${r.errorIds.join(", ")}` : "no errors recorded"} · {r.userAgent.slice(0, 80)}
                  </span>
                </span>
                <ResolveButton kind="report" id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="overview" title="Overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Users" value={num(overview.users)} sub={`${num(overview.verified)} verified · ${num(overview.new7)} new this week`} />
          <Stat label="Active students" value={num(overview.active7)} sub={`last 7 days · ${num(overview.active30)} in 30 days`} />
          <Stat label="Books" value={num(overview.books)} sub={`${num(overview.courses)} courses · ${num(overview.failedBooks)} failed`} />
          <Stat label="Claude spend" value={usd(overview.spendMonth)} sub={`this month · ${usd(overview.spend30)} in 30 days`} />
        </div>
      </Section>

      <Section id="email" title="Email" description="Verification links, password resets, invites and reminders. If sending fails, the error shows up under Errors above.">
        <Card className="flex flex-col gap-3 p-4 text-sm">
          <p>
            <span className={mail.canSend ? "font-semibold text-success" : "font-semibold text-danger"}>{mail.canSend ? "Set up" : "Not set up"}</span> · {mail.detail} · from <span className="font-mono">{mail.from}</span>
          </p>
          {!mail.canSend && (
            <p className="text-muted">
              Set <span className="font-mono text-text">RESEND_API_KEY</span> (recommended) or the <span className="font-mono text-text">SMTP_*</span> settings, and <span className="font-mono text-text">EMAIL_FROM</span> with an address on a domain verified in Resend, then redeploy. See DEPLOY.md, step 5.
            </p>
          )}
          <TestEmailButton />
        </Card>
      </Section>

      <Section
        id="access"
        title="Program access"
        description="Limit an account to one program, or keep it out of one. Rules go by email, so they also apply to people who haven't signed up yet. Only this program: the person can use that program's classes, assignments and class courses, and nothing else (no own uploads, Hub or other programs; their own courses are kept but can't be opened). Blocked from this program: they can't join, teach in or see its classes; the rest of Coursebook works as usual."
      >
        <Card className="flex flex-col gap-4 p-4">
          {access.programs.length === 0 ? <p className="text-sm text-muted">There are no programs yet.</p> : <AccessRuleForm programs={access.programs} />}
        </Card>
        {access.rules.length > 0 && (
          <Table caption="Program access rules" head={["Email", "Rule", "Note", "Added", ""]}>
            {access.rules.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.email}</td>
                <td className={td}>
                  <span className={r.mode === "ONLY" ? "rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold" : "rounded bg-danger-bg px-1.5 py-0.5 text-xs font-semibold text-danger"}>
                    {r.mode === "ONLY" ? `Only ${r.program.name}` : `Blocked from ${r.program.name}`}
                  </span>
                </td>
                <td className={`${td} text-muted`}>{r.note ?? ""}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{formatInZone(r.createdAt, zone, "medium")}</td>
                <td className={`${td} text-right`}>
                  <RemoveRuleButton id={r.id} email={r.email} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        id="demo"
        title="Demo data"
        description="Fill the app with an invented class to try the class features: a tutor, the class Demo: SAT Math, 10 students at different levels, a short course, assignments, diagnostic results and tutor chats. Every demo record is marked as demo and is deleted in one step. Real accounts and data are never touched."
      >
        <Card className="flex flex-col gap-3 p-4 text-sm">
          {!demo.allowed ? (
            <p className="text-muted">Demo data is turned off on this production deployment (set DEMO_DATA_ALLOWED=true to allow it).</p>
          ) : (
            <>
              <p>
                {demo.loaded ? (
                  <>
                    <span className="font-semibold text-success">Loaded</span> · {demo.users} demo accounts · join code <span className="font-mono">{demo.joinCode}</span>
                  </>
                ) : (
                  <span className="text-muted">Not loaded.</span>
                )}
              </p>
              <p className="text-muted">
                Sign in as the tutor with <span className="font-mono text-text">{DEMO_TUTOR_EMAIL}</span>, or as a student with <span className="font-mono text-text">student1@{DEMO_MODE_DOMAIN}</span> to <span className="font-mono text-text">student10@…</span>. Password for all: <span className="font-mono text-text">{DEMO_MODE_PASSWORD}</span>
              </p>
              <DemoDataControls loaded={demo.loaded} />
            </>
          )}
        </Card>
      </Section>

      <Section id="spend" title="Claude API spend" description="Last 30 days, from the cost recorded with every API call.">
        <Card className="p-4">
          {spend.daily.length === 0 ? (
            <p className="text-sm text-muted">No API calls in the last 30 days.</p>
          ) : (
            <div className="flex h-28 items-end gap-1" role="img" aria-label={`Daily spend over ${spend.daily.length} days, highest ${usd(maxDay)}`}>
              {spend.daily.map((d) => (
                <div key={d.day} title={`${d.day}: ${usd(d.usd)}`} className="flex-1 rounded-t bg-primary/80" style={{ height: `${Math.max(2, (d.usd / maxDay) * 100)}%` }} />
              ))}
            </div>
          )}
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Table caption="Spend by feature" head={["Feature", "Calls", "Tokens in / out", "Cost"]}>
            {spend.byFeature.map((f) => (
              <tr key={f.feature}>
                <td className={td}>{FEATURE_LABELS[f.feature] ?? f.feature}</td>
                <td className={`${td} tabular-nums`}>{num(f.calls)}</td>
                <td className={`${td} tabular-nums`}>
                  {num(f.inputTokens)} / {num(f.outputTokens)}
                </td>
                <td className={`${td} tabular-nums`}>{usd(f.usd)}</td>
              </tr>
            ))}
          </Table>
          <div className="flex flex-col gap-4">
            <Table caption="Spend by model" head={["Model", "Calls", "Cost"]}>
              {spend.byModel.map((m) => (
                <tr key={m.model}>
                  <td className={`${td} font-mono text-xs`}>{m.model}</td>
                  <td className={`${td} tabular-nums`}>{num(m.calls)}</td>
                  <td className={`${td} tabular-nums`}>{usd(m.usd)}</td>
                </tr>
              ))}
            </Table>
            <Table caption="Top users by spend" head={["Top users", "Plan", "Cost"]}>
              {spend.topUsers.map((u) => (
                <tr key={u.userId}>
                  <td className={`${td} break-all`}>{u.email}</td>
                  <td className={td}>{u.plan ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{usd(u.usd)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </Section>

      <Section
        id="failures"
        title={`Failed work${failedTotal ? ` (${failedTotal})` : ""}`}
        description="Retrying runs on the owner's behalf, so their plan limits still apply."
      >
        {failedTotal === 0 ? (
          <Card className="p-4 text-sm text-muted">Nothing has failed. 🎉</Card>
        ) : (
          <div className="flex flex-col gap-4">
            {failures.books.length > 0 && (
              <Table caption="Books that couldn't be read" head={["Book", "Student", "Error", ""]}>
                {failures.books.map((b) => (
                  <tr key={b.id}>
                    <td className={`${td} break-all`}>
                      {b.filename}
                      <span className="block text-xs text-muted">{date(b.at)}</span>
                    </td>
                    <td className={`${td} break-all`}>{b.email}</td>
                    <td className={td}>
                      {b.error}
                      {b.detail && (
                        <details className="mt-1 text-xs text-muted">
                          <summary className="cursor-pointer">Technical detail{b.step ? ` (step: ${b.step})` : ""}</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-all">{b.detail}</pre>
                        </details>
                      )}
                    </td>
                    <td className={td}>
                      <RetryButton kind="book" id={b.id} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            {failures.lessons.length > 0 && (
              <Table caption="Courses with failed lessons" head={["Course", "Student", "Failed lessons", ""]}>
                {failures.lessons.map((c) => (
                  <tr key={c.courseId}>
                    <td className={td}>
                      {c.title}
                      {c.error && <span className="block text-xs text-muted">{c.error}</span>}
                    </td>
                    <td className={`${td} break-all`}>{c.email}</td>
                    <td className={`${td} tabular-nums`}>{c.failed}</td>
                    <td className={td}>
                      <RetryButton kind="lessons" id={c.courseId} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            {failures.assessments.length > 0 && (
              <Table caption="Tests that couldn't be written" head={["Test", "Student", "Error", ""]}>
                {failures.assessments.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.title}</td>
                    <td className={`${td} break-all`}>{a.email}</td>
                    <td className={td}>{a.error}</td>
                    <td className={td}>
                      <RetryButton kind="assessment" id={a.id} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Section>

      <Section id="features" title="Feature use" description="Last 30 days.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {usage.map((u) => (
            <div key={u.label} className="rounded-xl border border-border bg-surface px-4 py-3">
              <p className="text-xl font-semibold tabular-nums">{num(u.count)}</p>
              <p className="text-sm text-muted">{u.label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="users" title="Users" description="Newest first (up to 50). Change a student's plan to give them higher limits.">
        <form className="flex gap-2" role="search">
          <label htmlFor="admin-user-search" className="sr-only">
            Search users by email or name
          </label>
          <input id="admin-user-search" name="q" defaultValue={q} placeholder="Search by email or name" className={`${inputClasses} max-w-sm`} />
          <button type="submit" className={buttonClasses("secondary")}>
            Search
          </button>
        </form>
        <Table caption="Users" head={["User", "Joined", "Courses", "AI this month", "Plan", ...(viewerIsOwner ? ["Role"] : [])]}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className={`${td} break-all`}>
                <span className="font-medium">{u.name}</span>
                {u.role === "TUTOR" && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs">tutor</span>}
                {(u.role === "ADMIN" || u.role === "OWNER") && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs">admin</span>}
                <span className="block text-xs text-muted">
                  {u.email}
                  {!u.emailVerified && " · not verified"}
                </span>
              </td>
              <td className={`${td} whitespace-nowrap`}>{date(u.createdAt)}</td>
              <td className={`${td} tabular-nums`}>{u.courses}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>
                {usd(u.usdThisMonth)} <span className="text-muted">/ {usd(u.budget)}</span>
              </td>
              <td className={td}>
                <PlanSelect userId={u.id} plan={u.plan} email={u.email} />
              </td>
              {viewerIsOwner && (
                <td className={td}>
                  <RoleSelect userId={u.id} role={u.role} email={u.email} />
                </td>
              )}
            </tr>
          ))}
        </Table>
        {users.length === 0 && <p className="text-sm text-muted">No users match “{q}”.</p>}
      </Section>
      <Section id="delete-account" title="Delete an account" description="For a deletion request: removes the account and everything in it (courses, files, scores, answers). It can't be undone. A program admin with other people must hand over the program first.">
        <DeleteAccountForm />
      </Section>
    </div>
  );
}
