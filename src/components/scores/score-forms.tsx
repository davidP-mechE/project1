"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { addScoreAction, deleteScoreAction, setProfileAction, verifyScoreAction } from "@/server/actions/scores";
import { DOMAINS, SECTIONS } from "@/lib/sat/domains";
import { MISS_REASONS, REASON_LABEL, SCORE_SOURCES, SOURCE_LABEL } from "@/lib/sat/scores";
import { parseQuestionReview } from "@/lib/sat/cb-import";

const select = "h-11 rounded-lg border border-border bg-surface px-3 text-sm";
type Miss = { section: "MATH" | "RW"; module: 1 | 2; number: string; domain: string; reason: string };

/**
 * Add a score: official (SAT, PSAT), a practice test (e.g. Bluebook), or our
 * diagnostic. Missed questions are entered by number and topic only; there's
 * deliberately no box for question text.
 */
export function ScoreForm({ target, first }: { target?: { classId: string; studentId: string }; first?: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<string>(first ? "PSAT" : "PRACTICE_BLUEBOOK");
  const [takenOn, setTakenOn] = useState("");
  const [testName, setTestName] = useState("");
  const [total, setTotal] = useState("");
  const [rw, setRw] = useState("");
  const [math, setMath] = useState("");
  const [misses, setMisses] = useState<Miss[]>([]);
  const [bands, setBands] = useState<Record<string, string>>({});
  const [reviewText, setReviewText] = useState("");
  const review = reviewText.trim() ? parseQuestionReview(reviewText) : null;
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addScoreAction(
            {
              source,
              takenOn,
              ...(testName.trim() ? { testName } : {}),
              total: num(total),
              rw: num(rw),
              math: num(math),
              ...(first ? { isBaseline: true } : {}),
              missed: misses.map((m) => ({ section: m.section, module: m.module, number: Number(m.number), domain: m.domain, ...(m.reason ? { reason: m.reason } : {}) })),
              ...(Object.values(bands).some(Boolean) ? { domainBands: Object.fromEntries(Object.entries(bands).filter(([, v]) => v).map(([d, v]) => [d, Number(v)])) } : {}),
              ...(review?.questions.length ? { review: review.questions } : {}),
            },
            target,
          );
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: "Saved." });
          setTotal("");
          setRw("");
          setMath("");
          setMisses([]);
          setBands({});
          setReviewText("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Test</span>
          <select className={select} value={source} onChange={(e) => setSource(e.target.value)}>
            {SCORE_SOURCES.filter((s) => s !== "DIAGNOSTIC" || !first).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <Field label="Date taken" type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} required />
        {source.startsWith("PRACTICE") && <Field label="Test name (optional)" value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="e.g. Bluebook Practice Test 4" maxLength={120} />}
        <Field label="Total score" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} required placeholder="400–1600" hint="In steps of 10." />
        <Field label="Reading and Writing (optional)" inputMode="numeric" value={rw} onChange={(e) => setRw(e.target.value)} placeholder="200–800" />
        <Field label="Math (optional)" inputMode="numeric" value={math} onChange={(e) => setMath(e.target.value)} placeholder="200–800" />
      </div>
      {source !== "DIAGNOSTIC" && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">From the College Board score report: Knowledge and Skills (optional)</summary>
          <p className="mt-2 text-xs text-muted">Your College Board score report shows how you did in each content area as a row of boxes (1 to 7 filled). Pick the number for each area; it shows your tutors where to focus.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {DOMAINS.map((d) => (
              <label key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {d.name} <span className="text-xs text-muted">({d.section === "MATH" ? "Math" : "R&W"})</span>
                </span>
                <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={bands[d.id] ?? ""} onChange={(e) => setBands({ ...bands, [d.id]: e.target.value })}>
                  <option value="">–</option>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n} of 7
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
      {source.startsWith("PRACTICE") && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Paste the question review from Bluebook or My Practice (optional)</summary>
          <p className="mt-2 text-xs text-muted">
            In College Board&apos;s My Practice, open the test&apos;s question review, select the table (question, section, module, content domain, skill, and your result or answer) and paste it here. Only those columns are read; any question text is ignored and never saved. Missed questions go into your mistake log.
          </p>
          <label htmlFor="review-paste" className="sr-only">
            Question review
          </label>
          <textarea id="review-paste" value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs" placeholder={"Question\tSection\tModule\tContent Domain\tSkill\tResult\n1\tMath\t1\tAlgebra\tLinear functions\tCorrect"} />
          {review && (
            <div role="status" className="mt-2 text-xs">
              <p className="font-medium">
                Read {review.questions.length} question{review.questions.length === 1 ? "" : "s"}: {review.questions.filter((q) => !q.correct).length} missed.
                {review.ignoredColumns.length > 0 && <span className="font-normal text-muted"> Ignored columns: {review.ignoredColumns.slice(0, 4).join(", ")}.</span>}
              </p>
              {review.skipped.length > 0 && (
                <p className="text-warning">
                  Skipped {review.skipped.length} row{review.skipped.length === 1 ? "" : "s"}: {review.skipped.slice(0, 3).map((r) => `line ${r.line} (${r.reason})`).join("; ")}
                  {review.skipped.length > 3 ? "…" : ""}
                </p>
              )}
            </div>
          )}
        </details>
      )}
      {source !== "DIAGNOSTIC" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Missed questions (optional)</legend>
          <p className="text-xs text-muted">Just the question number and its topic, from your score report. They go into your mistake log as practice on that skill. Don&apos;t copy the questions themselves.</p>
          {misses.map((m, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
              <label className="flex flex-col gap-1 text-xs">
                Section
                <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={m.section} onChange={(e) => setMisses(misses.map((x, j) => (j === i ? { ...x, section: e.target.value as Miss["section"], domain: DOMAINS.find((d) => d.section === e.target.value)!.id } : x)))}>
                  {SECTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Module
                <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={m.module} onChange={(e) => setMisses(misses.map((x, j) => (j === i ? { ...x, module: Number(e.target.value) as 1 | 2 } : x)))}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Question #
                <input className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm" inputMode="numeric" value={m.number} onChange={(e) => setMisses(misses.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} required />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Topic
                <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={m.domain} onChange={(e) => setMisses(misses.map((x, j) => (j === i ? { ...x, domain: e.target.value } : x)))}>
                  {DOMAINS.filter((d) => d.section === m.section).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Why
                <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={m.reason} onChange={(e) => setMisses(misses.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))}>
                  <option value="">(not sure)</option>
                  {MISS_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="ghost" onClick={() => setMisses(misses.filter((_, j) => j !== i))} aria-label={`Remove missed question ${i + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" variant="secondary" onClick={() => setMisses([...misses, { section: "MATH", module: 1, number: "", domain: "algebra", reason: "" }])}>
              Add a missed question
            </Button>
          </div>
        </fieldset>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          {first ? "Save my baseline" : "Save score"}
        </Button>
      </div>
    </form>
  );
}

/** No score yet: take the diagnostic first (the site keeps reminding until there's a baseline). */
export function BaselinePendingButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => { await setProfileAction({ baselinePending: true }); router.refresh(); })}>
      I don&apos;t have a score yet: I&apos;ll take the diagnostic
    </Button>
  );
}

export function GoalForm({ targetScore, testDate, targets, officialDates = [] }: { targetScore: number | null; testDate: string | null; targets: number[]; officialDates?: string[] }) {
  const router = useRouter();
  const [target, setTarget] = useState(targetScore ? String(targetScore) : "");
  const [date, setDate] = useState(testDate ?? "");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await setProfileAction({ targetScore: target ? Number(target) : null, testDate: date || null });
          setMsg(res.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: res.error });
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">My goal</span>
        <select className={select} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose…</option>
          {[...new Set([...targets, 1100, 1200, 1300, 1400, 1500])].sort((a, b) => a - b).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {officialDates.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Official SAT dates</span>
          <select className={select} value={officialDates.includes(date) ? date : ""} onChange={(e) => e.target.value && setDate(e.target.value)}>
            <option value="">Pick one…</option>
            {officialDates.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
              </option>
            ))}
          </select>
        </label>
      )}
      <Field label="My SAT date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Save
      </Button>
      {msg && (
        <span role="status" className={msg.tone === "error" ? "text-sm text-danger" : "text-sm text-muted"}>
          {msg.text}
        </span>
      )}
    </form>
  );
}

export function ScoreRowActions({ scoreId, verified, canDelete, verify }: { scoreId: string; verified: boolean; canDelete: boolean; verify?: { classId: string; studentId: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-1">
      {verify && !verified && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await verifyScoreAction(verify.classId, scoreId, verify.studentId); if (!r.ok) setError(r.error); router.refresh(); })}>
          Verify
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this score?")) return;
            start(async () => {
              const r = await deleteScoreAction(scoreId, verify?.classId);
              if (!r.ok) setError(r.error);
              router.refresh();
            });
          }}
        >
          Delete
        </Button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
