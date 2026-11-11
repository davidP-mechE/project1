import type { Metadata } from "next";
import Link from "next/link";
import { EnrollButton, PublishToggle } from "@/components/hub/hub-controls";
import { PillNav } from "@/components/review/filters";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { coverColor, subjectOf } from "@/lib/subjects";
import { enrollAction } from "@/server/actions/hub";
import { listCatalog } from "@/server/catalog";
import { db } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Hub" };

/** Provided courses (e.g. OpenStax textbooks), ready to study: add one to your library in a click. */
export default async function HubPage({ searchParams }: PageProps<"/hub">) {
  const user = await requireUser();
  const sp = await searchParams;
  const admin = (await db.user.findUnique({ where: { id: user.id }, select: { role: true } }))?.role === "ADMIN";
  const entries = await listCatalog(user.id, { includeHidden: admin });
  const subjects = [...new Set(entries.map((e) => e.subject))];
  const subject = typeof sp.subject === "string" && subjects.includes(sp.subject) ? sp.subject : null;
  const shown = subject ? entries.filter((e) => e.subject === subject) : entries;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Hub"
        description="Provided courses, ready to study: free, openly licensed textbooks turned into full courses with lessons, practice, flashcards and tests, and The 1600 Project's SAT lesson slides. Add one to your library and it's yours to study."
      />
      {sp.error === "unavailable" && <Alert tone="error">That course isn&apos;t available any more.</Alert>}
      {admin && (
        <Alert tone="info">
          You&apos;re an admin: to add a provided course, upload and generate it in your library, then use &quot;Publish to the Hub&quot; at the bottom of its course page.
        </Alert>
      )}
      {entries.length === 0 ? (
        <EmptyState title="No provided courses yet">Courses made from free textbooks (like OpenStax) will appear here when they&apos;re ready.</EmptyState>
      ) : (
        <>
          {subjects.length > 1 && (
            <PillNav
              label="Choose a subject"
              items={[{ href: "/hub", label: "All subjects", active: !subject }, ...subjects.map((s) => ({ href: `/hub?subject=${s}`, label: subjectOf(s).name, count: entries.filter((e) => e.subject === s).length, active: s === subject }))]}
            />
          )}
          <ul className="stagger-list grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((e) => (
              <li key={e.id} className="card-hover flex flex-col overflow-hidden rounded-lg border-[1.5px] border-border bg-surface">
                <div className="hero-card flex min-h-48 gap-4 pb-8 pl-12 pr-5 pt-5 [--band:0.6rem] [--spine:1.25rem]" style={{ ["--cover" as string]: coverColor(e.subject) }}>
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
                    <span className="self-start rounded bg-white px-2 py-0.5 text-xs font-bold text-[#17191f]">
                      {subjectOf(e.subject).name}
                    </span>
                    <h2 className="cover-title text-[1.9rem]">{e.title}</h2>
                  </div>
                  {e.hasCover && (
                    // eslint-disable-next-line @next/next/no-img-element -- auth-checked API image
                    <img src={`/api/hub/${e.id}/cover`} alt="" className="h-32 w-24 shrink-0 self-end rounded-sm object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <p className="text-sm text-muted">{e.description}</p>
                  <p className="text-xs text-muted">
                    {e.lessons} lessons · {e.pages} {e.kind === "SLIDES" ? "slides" : "pages"} · {e.license}
                    {e.students > 0 && ` · ${e.students} ${e.students === 1 ? "student" : "students"}`}
                  </p>
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer font-semibold">Credits</summary>
                    <p className="mt-1">{e.attribution}</p>
                    {e.sourceUrl && (
                      <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">
                        Original book ↗
                      </a>
                    )}
                  </details>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    {e.myCourseId ? (
                      <Link href={`/courses/${e.myCourseId}`} className={buttonClasses("secondary", "sm")}>
                        Open<span className="sr-only"> {e.title}</span>
                      </Link>
                    ) : (
                      <form action={enrollAction.bind(null, e.id)}>
                        <EnrollButton title={e.title} />
                      </form>
                    )}
                    {admin && (
                      <>
                        {!e.published && <span className="rounded bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">Hidden</span>}
                        <PublishToggle entryId={e.id} published={e.published} />
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
