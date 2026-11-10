"use client";

import { formatInZone } from "@/lib/dates";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { Countdown } from "@/components/classes/question-set";
import { DesmosButton } from "./desmos";
import { answerDiagnosticAction, startDiagnosticAction, submitModuleAction } from "@/server/actions/practice";
import { domainName, sectionName } from "@/lib/sat/domains";
import { cn } from "@/lib/utils";

type Q = { id: string; label: string; type: string; prompt: string; choices: string[]; section: string | null; desmos: boolean };
type Review = Q & { correctChoice: number | null; answer: string; explanation: string; yourChoice: number | null; yourResponse: string | null; correct: boolean };
export type DiagnosticView =
  | { phase: "before"; id: string; title: string; open: boolean; canStart: boolean; opensAt: string | null; closesAt: string | null; sections: string[]; moduleCount: number; attemptsUsed: number; attemptsAllowed: number }
  | { phase: "taking"; id: string; title: string; module: { id: string; section: string; number: number; endsAt: string }; moduleCount: number; questions: Q[]; saved: Record<string, { choice: number | null; response: string | null }> }
  | { phase: "done"; id: string; title: string; canStart: boolean; closesAt: string | null; results: { sections: { section: string; route: string; correct: number; total: number; estimate: number }[]; total: number | null } | null; domains: { domain: string; accuracy: number; n: number }[]; review: Review[] | null };

/** Wall-clock time, read only in event handlers and effects. */
const clock = () => Date.now();
const letter = (i: number) => String.fromCharCode(65 + i);
const when = (d: string, zone: string) => formatInZone(d, zone, "full");

/** Taking a diagnostic: timed modules with the clock on the server; module 2 depends on module 1. */
export function DiagnosticTaker({ view, desmosKey, zone }: { view: DiagnosticView; desmosKey: string | null; zone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (view.phase === "before") {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-sm">
          {view.sections.length === 2 ? "Reading and Writing, then Math" : sectionName(view.sections[0])}: {view.moduleCount} timed modules. Your second module in each section is harder or easier depending on how the first one goes, like the digital SAT.
        </p>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>The clock keeps running if you close the page or lose your connection. Come back to carry on with the time that&apos;s left.</li>
          <li>You can&apos;t go back to a module once it&apos;s handed in.</li>
          <li>You get one attempt{view.attemptsAllowed > 1 ? ` (your teacher allowed ${view.attemptsAllowed})` : ""}. Results show at the end; answers and explanations after it closes.</li>
          <li>Your score is an estimate, not an official SAT score.</li>
        </ul>
        {!view.open && <Alert tone="info">{view.opensAt && new Date(view.opensAt) > new Date() ? `Opens ${when(view.opensAt, zone)}.` : "This diagnostic has closed."}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {view.canStart && (
          <div>
            <Button
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Start now? The clock starts right away and keeps running.")) return;
                start(async () => {
                  const r = await startDiagnosticAction(view.id);
                  if (!r.ok) return setError(r.error);
                  router.refresh();
                });
              }}
            >
              Start the diagnostic
            </Button>
          </div>
        )}
      </Card>
    );
  }
  if (view.phase === "taking") return <ModuleView key={view.module.id} view={view} desmosKey={desmosKey} />;
  return <Results view={view} zone={zone} />;
}

function ModuleView({ view, desmosKey }: { view: Extract<DiagnosticView, { phase: "taking" }>; desmosKey: string | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState(view.saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const last = useRef<number | null>(null);
  useEffect(() => {
    last.current = clock();
  }, []);
  const desmosUsed = useRef(new Set<string>());
  const answered = view.questions.filter((q) => saved[q.id]).length;

  const save = async (q: Q, input: { choice?: number; response?: string }) => {
    const now = clock();
    const r = await answerDiagnosticAction(view.id, q.id, { ...input, timeMs: now - (last.current ?? now), usedDesmos: desmosUsed.current.has(q.id) });
    last.current = now;
    if (!r.ok) {
      setError(r.error);
      router.refresh();
      return;
    }
    setError(null);
    setSaved((s) => ({ ...s, [q.id]: { choice: input.choice ?? null, response: input.response ?? null } }));
  };
  const handIn = useCallback(() => {
    start(async () => {
      await submitModuleAction(view.id, view.module.id);
      router.refresh();
    });
  }, [view.id, view.module.id, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <span className="text-sm font-semibold">
          {sectionName(view.module.section)} · Module {view.module.number} of {view.moduleCount}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-sm text-muted tabular-nums">
            {answered}/{view.questions.length} answered
          </span>
          <Countdown endsAt={view.module.endsAt} onEnd={handIn} />
        </span>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {view.questions.map((q, n) => (
        <Card key={q.id} className="flex flex-col gap-3">
          <p className="text-xs font-medium text-muted">Question {n + 1}</p>
          <Markdown>{q.prompt}</Markdown>
          {q.desmos && <DesmosButton apiKey={desmosKey} onUse={() => desmosUsed.current.add(q.id)} />}
          {q.type === "MULTIPLE_CHOICE" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Choices for question {n + 1}</legend>
              {q.choices.map((c, k) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", saved[q.id]?.choice === k ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2")}>
                  <input type="radio" name={`q-${q.id}`} checked={saved[q.id]?.choice === k} onChange={() => save(q, { choice: k })} className="mt-1 size-4 accent-[var(--primary)]" />
                  <span className="font-semibold text-muted">{letter(k)}.</span>
                  <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                </label>
              ))}
            </fieldset>
          ) : (
            <GridIn label={`Your answer to question ${n + 1}`} initial={saved[q.id]?.response ?? ""} onSave={(response) => save(q, { response })} />
          )}
        </Card>
      ))}
      <div>
        <Button
          disabled={pending}
          onClick={() => {
            if (!window.confirm(answered < view.questions.length ? `You've answered ${answered} of ${view.questions.length}. Hand in this module anyway? You can't come back to it.` : "Hand in this module? You can't come back to it.")) return;
            handIn();
          }}
        >
          Hand in this module
        </Button>
      </div>
    </div>
  );
}

function GridIn({ label, initial, onSave }: { label: string; initial: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(initial);
  const [state, setState] = useState<"saved" | "dirty" | "saving">(initial ? "saved" : "dirty");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <input value={v} onChange={(e) => (setV(e.target.value), setState("dirty"))} className="h-11 w-48 rounded-lg border border-border bg-surface px-3" inputMode="text" maxLength={30} placeholder="e.g. 3/4 or 0.75" />
      </label>
      <Button
        size="sm"
        variant="secondary"
        disabled={!v.trim() || state !== "dirty"}
        onClick={async () => {
          setState("saving");
          await onSave(v);
          setState("saved");
        }}
      >
        {state === "saved" ? "Saved" : "Save answer"}
      </Button>
    </div>
  );
}

function Results({ view, zone }: { view: Extract<DiagnosticView, { phase: "done" }>; zone: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Your estimated scores</h2>
        <div className="flex flex-wrap gap-6">
          {view.results?.sections.map((s) => (
            <div key={s.section} className="flex flex-col">
              <span className="text-xs font-medium text-muted">{sectionName(s.section)}</span>
              <span className="text-3xl font-semibold tabular-nums">{s.estimate}</span>
              <span className="text-xs text-muted">
                {s.correct}/{s.total} right · {s.route === "M2_HARD" ? "harder" : "easier"} module 2
              </span>
            </div>
          ))}
          {view.results?.total != null && (
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted">Total</span>
              <span className="text-3xl font-semibold tabular-nums text-primary">{view.results.total}</span>
              <span className="text-xs text-muted">Saved to your SAT scores</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted">These are estimates from this diagnostic, not official SAT scores.</p>
      </Card>
      <Card>
        <h2 className="mb-3 text-lg font-semibold">By topic</h2>
        <ul className="flex flex-col gap-3">
          {view.domains.map((d) => (
            <li key={d.domain} className="flex flex-col gap-1">
              <span className="flex justify-between text-sm">
                <span>{domainName(d.domain)}</span>
                <span className="tabular-nums text-muted">{Math.round(d.accuracy * 100)}%</span>
              </span>
              <ProgressBar value={d.accuracy * 100} label={`${domainName(d.domain)}: ${Math.round(d.accuracy * 100)}% right`} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Questions you missed are in your mistake log to practise again.</p>
      </Card>
      {view.review ? (
        <section aria-labelledby="review" className="flex flex-col gap-3">
          <h2 id="review" className="text-lg font-semibold">
            Answers and explanations
          </h2>
          {view.review.map((q, n) => (
            <Card key={q.id} className="flex flex-col gap-2">
              <p className={cn("text-xs font-semibold", q.correct ? "text-success" : "text-danger")}>
                Question {n + 1}: {q.correct ? "right" : "wrong"}
              </p>
              <Markdown>{q.prompt}</Markdown>
              <p className="text-sm">
                <strong>Answer:</strong> {q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? `${letter(q.correctChoice)}. ${q.choices[q.correctChoice]}` : q.answer}
                {!q.correct && <span className="text-muted"> · yours: {q.yourChoice !== null ? letter(q.yourChoice) : q.yourResponse || "(blank)"}</span>}
              </p>
              {q.explanation && <p className="text-sm text-muted">{q.explanation}</p>}
            </Card>
          ))}
        </section>
      ) : (
        view.closesAt && <Alert tone="info">Answers and explanations appear after the diagnostic closes ({when(view.closesAt, zone)}), so no one sees them while others are still taking it.</Alert>
      )}
    </div>
  );
}
