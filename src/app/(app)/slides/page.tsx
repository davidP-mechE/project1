import type { Metadata } from "next";
import { CourseCard, type CourseCardData } from "@/components/library/course-card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";
import { listCourses } from "@/server/courses";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Slides" };

/** Lecture slide decks, each turned into a mini-course. */
export default async function SlidesPage() {
  const user = await requireUser();
  const decks = await listCourses(user.id, { archived: false, kind: "SLIDES" });
  const now = new Date();
  const cards: CourseCardData[] = decks.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    progressPct: c.progressPct,
    lastOpenedAt: c.lastOpenedAt?.toISOString() ?? null,
    lastOpenedLabel: c.lastOpenedAt ? timeAgo(c.lastOpenedAt, now) : "",
    archived: false,
    coverUrl: c.book.coverKey ? `/api/books/${c.book.id}/cover` : null,
  }));

  return (
    <>
      <PageHeader
        title="Lecture slides"
        description="Upload a deck from class and get a mini-course: short lessons that explain each slide, practice sets and flashcards."
        actions={<ButtonLink href="/slides/upload">Upload slides</ButtonLink>}
      />
      {cards.length === 0 ? (
        <EmptyState title="No slide decks yet" action={<ButtonLink href="/slides/upload">Upload your first deck</ButtonLink>}>
          Upload lecture slides as a PDF or PowerPoint file. Coursebook groups them into lessons, explains the bullet points (using your
          teacher&apos;s speaker notes and diagrams too), and builds practice to help it stick.
        </EmptyState>
      ) : (
        <ul className="stagger-list grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </ul>
      )}
    </>
  );
}
