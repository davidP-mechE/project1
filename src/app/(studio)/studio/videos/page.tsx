import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { BulkVideoStatus, VideoReviewRow } from "@/components/studio/review-forms";
import { requireOwner } from "@/server/owner-guard";
import { studioVideos } from "@/server/studio";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/studio/blocks";

export const metadata: Metadata = { title: "Video review", robots: { index: false, follow: false } };

/** Every video in every course, to approve in one pass. Students see approved videos only. */
export default async function VideoReviewPage({ searchParams }: PageProps<"/studio/videos">) {
  const owner = await requireOwner();
  const sp = await searchParams;
  const filter = (REVIEW_STATUSES as readonly string[]).includes(String(sp.status)) ? (sp.status as ReviewStatus) : null;
  const all = await studioVideos(owner.id);
  const shown = filter ? all.filter((v) => v.video.reviewStatus === filter) : all;
  const count = (st: ReviewStatus) => all.filter((v) => v.video.reviewStatus === st).length;
  const courses = [...new Set(shown.map((v) => v.lesson.unit.course.title))];
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/studio" className="text-muted hover:underline">← Course Studio</Link>
      </p>
      <PageHeader eyebrow="Owner only" title="Video review" description="Every video in your courses. Students only see approved videos; hidden ones stay in the lesson for you." />
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
        {[null, ...REVIEW_STATUSES].map((st) => (
          <Link key={st ?? "all"} href={st ? `/studio/videos?status=${st}` : "/studio/videos"} aria-current={filter === st ? "page" : undefined} className={filter === st ? "rounded-md bg-text px-3 py-1.5 font-semibold text-bg" : "rounded-md border-[1.5px] border-border px-3 py-1.5 hover:border-text"}>
            {st ? `${st[0].toUpperCase()}${st.slice(1)} (${count(st)})` : `All (${all.length})`}
          </Link>
        ))}
      </nav>
      {count("unreviewed") > 0 && <BulkVideoStatus ids={all.filter((v) => v.video.reviewStatus === "unreviewed").map((v) => v.id)} />}
      {shown.length === 0 && <p className="text-sm text-muted">No videos here.</p>}
      {courses.map((course) => (
        <Card key={course} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{course}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {shown
              .filter((v) => v.lesson.unit.course.title === course)
              .map((v) => (
                <VideoReviewRow
                  key={v.id}
                  blockId={v.id}
                  video={v.video}
                  where={`${v.lesson.unit.title} · ${v.lesson.number ? `${v.lesson.number} ` : ""}${v.lesson.title}`}
                  lessonHref={`/studio/lessons/${v.lesson.id}`}
                />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
