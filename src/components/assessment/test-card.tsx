import { formatInZone } from "@/lib/dates";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { AssessmentPoller, RegenerateButton } from "./assessment-status";

type Props = {
  courseId: string;
  kind: "UNIT_TEST" | "FINAL_EXAM";
  takeHref: string;
  assessment: { id: string; status: string; error: string | null; questionCount: number } | null;
  attempts: { id: string; score: number; correct: number; total: number; createdAt: Date }[];
  notYet: string;
};

/** The "take the test" card: status, best score, past attempts. */
export function TestCard({ courseId, kind, takeHref, assessment, attempts, notYet, zone }: Props & { zone: string }) {
  const name = kind === "UNIT_TEST" ? "Unit test" : "Final exam";
  const best = attempts.length ? Math.max(...attempts.map((a) => a.score)) : null;
  const busy = assessment?.status === "QUEUED" || assessment?.status === "GENERATING";
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{name}</h2>
          {!assessment && <p className="mt-1 text-sm text-muted">{notYet}</p>}
          {busy && (
            <div className="mt-2">
              <AssessmentPoller active />
            </div>
          )}
          {assessment?.status === "FAILED" && <p className="mt-1 text-sm text-danger">{assessment.error ?? "It couldn't be written."}</p>}
          {assessment?.status === "READY" && (
            <p className="mt-1 text-sm text-muted">
              {assessment.questionCount} questions · about {Math.max(5, Math.round(assessment.questionCount * 1.5))} minutes
              {best !== null && ` · best score ${Math.round(best * 100)}%`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {assessment?.status === "READY" && assessment.questionCount > 0 && <ButtonLink href={takeHref}>{attempts.length ? "Take it again" : `Start the ${name.toLowerCase()}`}</ButtonLink>}
          {assessment && !busy && (
            <RegenerateButton courseId={courseId} assessmentId={assessment.id} label={assessment.status === "FAILED" ? "Try again" : "Write new questions"} />
          )}
        </div>
      </div>
      {attempts.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-sm">
          {attempts.map((a) => (
            <li key={a.id} className="flex justify-between gap-2">
              <span className="text-muted">{formatInZone(a.createdAt, zone, "dayTime")}</span>
              <span className="tabular-nums">
                {Math.round(a.score * 100)}% · {a.correct}/{a.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
