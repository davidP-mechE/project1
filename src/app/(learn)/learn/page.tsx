import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { getSession } from "@/server/session";
import { listPublicCourses } from "@/server/studio";

export const metadata: Metadata = { title: "Courses" };

const SECTION = { math: "Math", ebrw: "Reading and Writing", other: "Other" } as const;

/** Published courses only. Drafts never appear here or in its search. */
export default async function CatalogPage({ searchParams }: PageProps<"/learn">) {
  if (!(await getSession())) redirect("/login?next=/learn");
  const q = (await searchParams).q;
  const term = typeof q === "string" ? q.slice(0, 100) : "";
  const courses = await listPublicCourses(term);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader eyebrow="The 1600 Project" title="Courses" description="Lessons, Desmos checks and practice sets, written for Coursebook." />
      <form role="search" className="max-w-md">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Search courses
          <input name="q" defaultValue={term} className={inputClasses} />
        </label>
      </form>
      {courses.length === 0 ? (
        <EmptyState title={term ? "No courses match" : "No courses yet"}>{term ? "Try another word." : "New courses appear here when they're published."}</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((c) => (
            <Link key={c.id} href={`/learn/${c.slug}`}>
              <Card className="h-full hover:bg-surface-2">
                <p className="eyebrow">{SECTION[c.section]}</p>
                <p className="text-lg font-semibold">{c.title}</p>
                {c.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{c.description}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
