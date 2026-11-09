import type { Metadata } from "next";
import Link from "next/link";
import { CourseCard, type CourseCardData } from "@/components/library/course-card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";
import { listCourses } from "@/server/courses";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const user = await requireUser();
  const { view } = await searchParams;
  const archived = view === "archived";
  const courses = await listCourses(user.id, { archived });
  const now = new Date();
  const cards: CourseCardData[] = courses.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    progressPct: c.progressPct,
    lastOpenedAt: c.lastOpenedAt?.toISOString() ?? null,
    lastOpenedLabel: c.lastOpenedAt ? timeAgo(c.lastOpenedAt, now) : "",
    archived: c.archivedAt !== null,
  }));

  return (
    <>
      <PageHeader
        title="Your library"
        description="Each textbook you upload becomes its own course."
        actions={<ButtonLink href="/library/upload">Upload a textbook</ButtonLink>}
      />
      <nav aria-label="Library views" className="mb-6 flex gap-1 border-b border-border">
        {[
          { href: "/library", label: "Courses", active: !archived },
          { href: "/library?view=archived", label: "Archived", active: archived },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", t.active ? "border-primary font-medium" : "border-transparent text-muted hover:text-text")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {cards.length === 0 ? (
        archived ? (
          <EmptyState title="No archived courses">Courses you archive will appear here.</EmptyState>
        ) : (
          <EmptyState title="Your library is empty" action={<ButtonLink href="/library/upload">Upload your first textbook</ButtonLink>}>
            Upload a textbook PDF and Coursebook will turn it into a structured course you can study at your own pace.
          </EmptyState>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => <CourseCard key={c.id} course={c} />)}
        </ul>
      )}
    </>
  );
}
