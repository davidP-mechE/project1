import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { CourseOutline } from "@/components/studio/course-view";
import { getSession } from "@/server/session";
import { NotFoundError } from "@/server/courses";
import { courseForViewer } from "@/server/studio";

export const metadata: Metadata = { title: "Course" };

export default async function LearnCoursePage({ params }: PageProps<"/learn/[slug]">) {
  const { slug } = await params;
  const session = await getSession();
  let c;
  try {
    // First: may this visitor see it at all? Drafts are a 404 for everyone but the owner.
    c = await courseForViewer(session?.user.id ?? null, slug);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (!session) redirect(`/login?next=/learn/${slug}`);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader eyebrow={c.status === "published" ? "Course" : "Draft (only you can see this)"} title={c.title} />
      <CourseOutline course={c} lessonHref={(id) => `/learn/${c.slug}/lessons/${id}`} />
    </div>
  );
}
