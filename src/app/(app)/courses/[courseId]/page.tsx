import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CourseHeader } from "@/components/course/course-header";
import { GenerateButton } from "@/components/course/generate-button";
import { GenerationProgress } from "@/components/course/generation-progress";
import { ProcessingStatus } from "@/components/course/processing-status";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { formatBytes } from "@/lib/upload/limits";
import { getOutlineSummary, getProcessingStatus, markCourseOpened } from "@/server/courses";
import { getCourseOr404 } from "@/server/course-page";
import { rangeText, type SourceKindName } from "@/lib/source-label";
import { claudeEnabled } from "@/server/env";
import { getCourseCost, getCourseLessons, getGenerationProgress } from "@/server/generation/lessons";
import { getGenerationEstimate } from "@/server/outline";
import { requireUser } from "@/server/session";
import { getStudyOutline } from "@/server/study";
import { getUnitScores } from "@/server/dashboard";
import { getCourseAssessments } from "@/server/assessments";
import { CreateAssessmentsButton } from "@/components/assessment/assessment-status";
import { UnitScores } from "@/components/dashboard/charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Course" };

const sourceLabels: Record<string, string> = {
  BOOKMARKS: "from the PDF's built-in bookmarks",
  HEADINGS: "by detecting headings (this PDF has no bookmarks)",
  PAGE_RANGES: "as fixed page ranges (no chapters or headings were found)",
  SLIDES: "from the slide titles and section slides",
};

function pageList(pages: number[]): string {
  // [3,4,5,9] -> "3–5, 9"
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j;
  }
  return parts.join(", ");
}

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  await markCourseOpened(user.id, courseId);
  const { book } = course;
  const fileAvailable = ["UPLOADED", "PROCESSING", "READY", "FAILED"].includes(book.status) && course.status !== "UPLOADING";
  const showStatus = course.status === "PROCESSING" || (course.status === "FAILED" && book.status !== "AWAITING_UPLOAD");
  const status = showStatus ? await getProcessingStatus(user.id, courseId) : null;
  const outline = ["OUTLINE_DRAFT", "GENERATING", "ACTIVE"].includes(course.status)
    ? await getOutlineSummary(user.id, courseId)
    : null;
  const generating = course.status === "GENERATING" || course.status === "ACTIVE";
  const [pendingEstimate, progress, units, cost, study] = outline
    ? await Promise.all([
        getGenerationEstimate(user.id, courseId, "pending"),
        generating ? getGenerationProgress(user.id, courseId) : null,
        generating ? getCourseLessons(user.id, courseId) : null,
        generating ? getCourseCost(user.id, courseId) : 0,
        generating ? getStudyOutline(user.id, courseId) : null,
      ])
    : [null, null, null, 0, null];
  const [unitScores, assessments] = study ? await Promise.all([getUnitScores(user.id, courseId), getCourseAssessments(user.id, courseId)]) : [[], []];
  const completed = new Set(study?.units.flatMap((u) => u.lessons.filter((l) => l.completed).map((l) => l.id)) ?? []);
  const noKey = claudeEnabled ? undefined : "Lesson generation needs an ANTHROPIC_API_KEY on the server (see the README).";

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />

      {course.status === "UPLOADING" && (
        <Alert tone="warning" className="mb-6">
          This upload didn&apos;t finish. Delete it from your library and try again.
        </Alert>
      )}

      {status && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold">
            {course.status === "FAILED" ? "We couldn't process this book" : "Reading your textbook…"}
          </h2>
          <ProcessingStatus key={course.status} courseId={courseId} initial={status} />
        </Card>
      )}

      {outline && course.status === "OUTLINE_DRAFT" && pendingEstimate && (
        <NextSteps courseId={courseId} generate={<GenerateButton courseId={courseId} estimate={pendingEstimate} disabledReason={noKey} />} />
      )}
      {study && (study.resume || study.done > 0) && <ContinueStudying courseId={courseId} study={study} />}
      {unitScores.some((u) => u.answered > 0) && (
        <Card className="mb-6">
          <h2 className="mb-1 text-lg font-semibold">Practice scores by unit</h2>
          <p className="mb-4 text-sm text-muted">Your latest answer to each practice question counts.</p>
          <UnitScores units={unitScores} />
        </Card>
      )}
      {progress && units && (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-lg font-semibold">Lessons</h2>
            {pendingEstimate && pendingEstimate.lessons > 0 && course.status === "ACTIVE" && (
              <GenerateButton courseId={courseId} estimate={pendingEstimate} label={`Generate ${pendingEstimate.lessons} remaining`} disabledReason={noKey} />
            )}
          </div>
          <GenerationProgress courseId={courseId} initial={progress} />
          {course.status === "ACTIVE" && (progress.flagged > 0 || progress.failed > 0) && (
            <Alert tone="warning" className="mb-4">
              {progress.flagged > 0 && `${progress.flagged} ${progress.flagged === 1 ? "lesson needs" : "lessons need"} your attention (not enough readable text). `}
              {progress.failed > 0 && `${progress.failed} ${progress.failed === 1 ? "lesson" : "lessons"} couldn't be written. `}
              Open {progress.flagged + progress.failed === 1 ? "it" : "them"} below to see why.
            </Alert>
          )}
          <LessonList courseId={courseId} units={units} completed={completed} assessments={assessments} />
          {course.status === "ACTIVE" && assessments.length === 0 && claudeEnabled && (
            <div className="mt-4">
              <CreateAssessmentsButton courseId={courseId} />
            </div>
          )}
          {cost > 0 && <p className="mt-4 text-xs text-muted">Claude API cost for this course so far: ${cost.toFixed(2)}</p>}
        </Card>
      )}
      {outline && course.status === "OUTLINE_DRAFT" && <OutlinePreview outline={outline} courseId={courseId} kind={course.book.kind} />}

      <Card>
        <h2 className="mb-4 text-lg font-semibold">File</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Size</dt>
            <dd className="font-medium">{formatBytes(Number(book.sizeBytes))}</dd>
          </div>
          <div>
            <dt className="text-muted">{course.book.kind === "SLIDES" ? "Slides" : "Pages"}</dt>
            <dd className="font-medium">{book.pageCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Uploaded</dt>
            <dd className="font-medium">
              <time dateTime={book.createdAt.toISOString()}>
                {book.createdAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
              </time>
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          {fileAvailable && (
            <a href={`/api/books/${book.id}/file`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
              {course.book.kind === "SLIDES" ? "Open the slides" : "Open original PDF"}
            </a>
          )}
          <ButtonLink href={course.book.kind === "SLIDES" ? "/slides" : "/library"} variant="ghost">
            {course.book.kind === "SLIDES" ? "Back to slides" : "Back to library"}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

function NextSteps({ courseId, generate }: { courseId: string; generate: ReactNode }) {
  const steps = [
    { title: "Check the outline", body: "Rename, merge, split or reorder lessons and fix page ranges.", href: `/courses/${courseId}/outline`, cta: "Edit outline", node: null },
    { title: "Choose settings", body: "Pick your level, explanation style and what to create. See the cost estimate.", href: `/courses/${courseId}/setup`, cta: "Course settings", node: null },
    { title: "Generate lessons", body: "Claude writes each lesson from its own pages. You can start studying as soon as the first one is ready.", href: null, cta: null, node: generate },
  ];
  return (
    <Card className="mb-6">
      <h2 className="text-lg font-semibold">Next steps</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-text" aria-hidden>
              {i + 1}
            </span>
            <h3 className="font-medium">{s.title}</h3>
            <p className="flex-1 text-sm text-muted">{s.body}</p>
            {s.href && (
              <ButtonLink href={s.href} variant="secondary" size="sm" className="self-start">
                {s.cta}
              </ButtonLink>
            )}
            {s.node && <div className="flex flex-col items-start gap-1">{s.node}</div>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function OutlinePreview({ outline, courseId, kind }: { outline: Awaited<ReturnType<typeof getOutlineSummary>>; courseId: string; kind: SourceKindName }) {
  const lessonCount = outline.units.reduce((n, u) => n + u.lessons.filter((l) => !l.skip).length, 0);
  const unitCount = outline.units.filter((u) => u.lessons.some((l) => !l.skip)).length;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">Course outline</h2>
        <ButtonLink href={`/courses/${courseId}/outline`} variant="secondary" size="sm">
          Edit outline
        </ButtonLink>
      </div>
      <p className="mt-1 text-sm text-muted">
        {unitCount} units and {lessonCount} lessons. The outline was first built {sourceLabels[outline.outlineSource ?? "PAGE_RANGES"]}.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {outline.ocrPages > 0 && (
          <Alert tone="info">
            {outline.ocrPages} scanned {outline.ocrPages === 1 ? "page was" : "pages were"} read with OCR (text recognition).
            OCR can make small mistakes.
          </Alert>
        )}
        {outline.mathHeavyPages.length > 0 && (
          <Alert tone="warning">
            Equation-heavy pages: {pageList(outline.mathHeavyPages)}. Equations don&apos;t always survive text extraction, so
            these pages will get extra care when lessons are written.
          </Alert>
        )}
        {outline.emptyPages > 0 && (
          <Alert tone="info">
            {outline.emptyPages} {outline.emptyPages === 1 ? "page has" : "pages have"} no readable text (blank pages, or
            pictures without words).
          </Alert>
        )}
      </div>

      <ol className="mt-5 flex flex-col gap-4">
        {outline.units.map((u) => (
          <li key={u.id} className={u.lessons.every((l) => l.skip) ? "text-muted" : undefined}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-semibold">
              <Link href={`/courses/${courseId}/units/${u.id}`} className="hover:underline">
                {u.title}
              </Link>
            </h3>
              {u.lessons.every((l) => l.skip) && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Skipped</span>
              )}
            </div>
            {!(u.lessons.length === 1 && u.lessons[0].title === u.title) && (
              <ol className="mt-1 flex flex-col gap-1 border-l border-border pl-4 text-sm">
                {u.lessons.map((l) => (
                  <li key={l.id} className={l.skip ? "flex justify-between gap-4 text-muted line-through" : "flex justify-between gap-4"}>
                    <span>{l.title}</span>
                    <span className="shrink-0 text-muted">
                      {rangeText(kind, l.pageStart, l.pageEnd)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {u.lessons.length === 1 && u.lessons[0].title === u.title && (
              <p className="mt-1 text-sm text-muted">
                {rangeText(kind, u.lessons[0].pageStart, u.lessons[0].pageEnd)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  READY: { label: "Ready", tone: "bg-success-bg text-success" },
  QUEUED: { label: "Waiting", tone: "bg-surface-2 text-muted" },
  GENERATING: { label: "Writing…", tone: "bg-primary/15 text-primary" },
  FLAGGED: { label: "Needs attention", tone: "bg-warning-bg text-warning" },
  FAILED: { label: "Failed", tone: "bg-danger-bg text-danger" },
  PENDING: { label: "Not written", tone: "bg-surface-2 text-muted" },
};

function ContinueStudying({ courseId, study }: { courseId: string; study: Awaited<ReturnType<typeof getStudyOutline>> }) {
  const lesson = study.resume ? study.units.flatMap((u) => u.lessons).find((l) => l.id === study.resume!.id) : null;
  const allDone = study.done === study.total && study.total > 0;
  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{allDone ? "You've finished every lesson 🎉" : "Your progress"}</h2>
          <div className="mt-3 flex flex-col gap-1.5">
            <ProgressBar value={study.pct} label="Course progress" />
            <p className="text-sm text-muted">
              {study.done} of {study.total} lessons complete · {study.pct}%
            </p>
          </div>
        </div>
        {lesson && study.resume && (
          <ButtonLink href={`/courses/${courseId}/lessons/${lesson.id}`} className="shrink-0">
            {study.resume.reason === "start" ? "Start lesson 1" : study.resume.reason === "continue" ? "Continue" : "Next lesson"}: {lesson.title.length > 28 ? `${lesson.title.slice(0, 27)}…` : lesson.title}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}

type CourseAssessments = Awaited<ReturnType<typeof getCourseAssessments>>;

function TestRow({ href, label, a }: { href: string; label: string; a: CourseAssessments[number] }) {
  const state =
    a.status === "READY"
      ? a.best !== null
        ? { text: `Best ${Math.round(a.best * 100)}%`, tone: a.best >= 0.8 ? "bg-success-bg text-success" : "bg-surface-2 text-muted" }
        : { text: `${a.questionCount} questions`, tone: "bg-primary/10 text-primary" }
      : a.status === "FAILED"
        ? { text: "Failed", tone: "bg-danger-bg text-danger" }
        : { text: "Writing…", tone: "bg-primary/15 text-primary" };
  return (
    <Link href={href} className="press-soft flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-2">
      <span className="flex items-center gap-2 font-medium">
        <span aria-hidden>📝</span> {label}
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", state.tone)}>{state.text}</span>
    </Link>
  );
}

function LessonList({ courseId, units, completed, assessments }: { courseId: string; units: Awaited<ReturnType<typeof getCourseLessons>>; completed: Set<string>; assessments: CourseAssessments }) {
  const final = assessments.find((a) => a.kind === "FINAL_EXAM");
  // Number included lessons 1, 2, 3… across the whole course.
  const numbers = new Map(
    units.flatMap((u) => u.lessons.filter((l) => !l.skip)).map((l, i) => [l.id, i + 1] as const),
  );
  return (
    <ol className="mt-4 flex flex-col gap-5">
      {units
        .filter((u) => u.lessons.some((l) => !l.skip))
        .map((u) => (
          <li key={u.id}>
            <h3 className="font-semibold">{u.title}</h3>
            <ol className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">
              {u.lessons
                .filter((l) => !l.skip)
                .map((l) => {
                  const st = STATUS_LABEL[l.status] ?? STATUS_LABEL.PENDING;
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/courses/${courseId}/lessons/${l.id}`}
                        className="press-soft flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="mr-2 tabular-nums text-muted">{numbers.get(l.id)}.</span>
                          {l.title}
                        </span>
                        {completed.has(l.id) && l.status === "READY" ? (
                          <span className="shrink-0 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">✓ Done</span>
                        ) : (
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", st.tone)}>{st.label}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              {(() => {
                const a = assessments.find((x) => x.unitId === u.id);
                return a ? (
                  <li>
                    <TestRow href={`/courses/${courseId}/units/${u.id}`} label="Unit test" a={a} />
                  </li>
                ) : null;
              })()}
            </ol>
          </li>
        ))}
      {final && (
        <li>
          <ol className="flex flex-col rounded-lg border border-primary/30 bg-primary/5">
            <li>
              <TestRow href={`/courses/${courseId}/final-exam`} label="Final exam" a={final} />
            </li>
          </ol>
        </li>
      )}
    </ol>
  );
}
