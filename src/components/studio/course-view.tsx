import Link from "next/link";
import { Markdown } from "@/components/lesson/markdown";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { DesmosCheck } from "@/components/desmos/desmos-check";
import { CalculatorPanel } from "@/components/desmos/calculator-panel";
import { CalloutBlock, CheckpointBlock, DesmosStepsBlock, VideoBlock } from "./lesson-blocks";
import { CalloutDataSchema, CheckpointDataSchema, DesmosStepsSchema, isDesmosSteps, VideoDataSchema } from "@/lib/studio/blocks";

type Course = { title: string; description: string; section: string; estimatedHours?: number | null; units: { id: string; title: string; summary?: string; lessons: { id: string; title: string; number?: string | null; estimatedMinutes?: number | null }[] }[] };
type Block = { id: string; kind: "markdown" | "file" | "desmos" | "question_set" | "video" | "callout" | "checkpoint"; data: unknown };
type FileRow = { id: string; name: string; contentType: string };

/** A course's outline, as students see it (also used by "Preview as student"). `base` builds lesson links. */
export function CourseOutline({ course, lessonHref }: { course: Course; lessonHref: (lessonId: string) => string }) {
  return (
    <div className="flex flex-col gap-4">
      {course.description && <p className="max-w-2xl text-muted">{course.description}</p>}
      {course.estimatedHours ? <p className="text-sm text-muted">About {course.estimatedHours} hours, self-paced.</p> : null}
      {course.units.map((u) => (
        <Card key={u.id} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{u.title}</h2>
          {u.summary && <p className="text-sm text-muted">{u.summary}</p>}
          {u.lessons.length === 0 ? (
            <p className="text-sm text-muted">No lessons yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {u.lessons.map((l, i) => (
                <li key={l.id}>
                  <Link href={lessonHref(l.id)} className="flex items-center gap-3 py-2 hover:underline">
                    <span className="w-8 shrink-0 text-sm tabular-nums text-muted">{l.number ?? `${i + 1}.`}</span>
                    <span className="flex-1">{l.title}</span>
                    {l.estimatedMinutes ? <span className="text-xs text-muted">{l.estimatedMinutes} min</span> : null}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ))}
    </div>
  );
}

/** A lesson's content blocks: text, files (served through the checked route), Desmos checks and question sets. */
export function LessonBlocks({ blocks, files, sets, section, desmosKey, lessonId, checkpoints = {}, canRecord = false }: { blocks: Block[]; files: FileRow[]; sets: Record<string, { id: string; title: string; status: string; questionIds: string[] }>; section: string; desmosKey: string | null; lessonId: string; checkpoints?: Record<string, Record<string, string>>; canRecord?: boolean }) {
  const fileOf = new Map(files.map((f) => [f.id, f]));
  return (
    <div className="flex flex-col gap-5">
      {section === "math" && (
        <div className="flex justify-end">
          <CalculatorPanel apiKey={desmosKey} storageKey={`studio-${lessonId}`} />
        </div>
      )}
      {blocks.length === 0 && <p className="text-sm text-muted">This lesson is empty.</p>}
      {blocks.map((b) => {
        const d = (b.data ?? {}) as Record<string, unknown>;
        if (b.kind === "markdown") return <Markdown key={b.id}>{String(d.text ?? "")}</Markdown>;
        if (b.kind === "file") {
          const f = fileOf.get(String(d.fileId));
          if (!f) return null;
          const url = `/api/studio/files/${f.id}`;
          if (f.contentType.startsWith("image/"))
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={b.id} src={url} alt={f.name.replace(/\.[a-z]+$/i, "")} className="max-w-full rounded-lg border border-border" />
            );
          return (
            <Card key={b.id} className="flex flex-col gap-2">
              <p className="font-semibold">{f.name}</p>
              <iframe src={url} title={f.name} className="hidden h-[70vh] w-full rounded border border-border sm:block" />
              <a href={url} target="_blank" rel="noopener" className="text-sm underline">
                Open the PDF<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Card>
          );
        }
        if (b.kind === "video") {
          const v = VideoDataSchema.safeParse(d);
          return v.success ? <VideoBlock key={b.id} data={v.data} /> : null;
        }
        if (b.kind === "callout") {
          const c = CalloutDataSchema.safeParse(d);
          return c.success ? <CalloutBlock key={b.id} data={c.data} /> : null;
        }
        if (b.kind === "checkpoint") {
          const c = CheckpointDataSchema.safeParse(d);
          return c.success ? <CheckpointBlock key={b.id} blockId={b.id} data={c.data} initial={checkpoints[b.id]} canRecord={canRecord} /> : null;
        }
        if (b.kind === "desmos" && isDesmosSteps(d)) return <DesmosStepsBlock key={b.id} data={DesmosStepsSchema.parse(d)} desmosKey={desmosKey} />;
        if (b.kind === "desmos")
          return (
            <Card key={b.id} className="flex flex-col gap-2">
              <p className="font-semibold">{String(d.title || "Desmos check")}</p>
              <DesmosCheck apiKey={desmosKey} state={(d.state as object) ?? {}} interactive={Boolean(d.interactive)} title={String(d.title || "Desmos check")} />
            </Card>
          );
        const set = sets[String(d.setId)];
        if (!set) return null;
        return (
          <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{set.title}</p>
              <p className="text-sm text-muted">
                Practice set · {set.questionIds.length} questions{set.status !== "published" ? " · draft (students won't see it until it's published)" : ""}
              </p>
            </div>
            <ButtonLink href={`/practice/${set.id}`} size="sm">Practise</ButtonLink>
          </Card>
        );
      })}
    </div>
  );
}

/** "In this lesson": the objectives and time, above the blocks. */
export function LessonIntro({ objectives, estimatedMinutes }: { objectives: string[]; estimatedMinutes: number | null }) {
  if (!objectives.length && !estimatedMinutes) return null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-sm font-semibold">In this lesson{estimatedMinutes ? ` · about ${estimatedMinutes} minutes` : ""}</p>
      {objectives.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {objectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
