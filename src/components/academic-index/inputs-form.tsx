"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { confirmReviewAction, saveDraftAction, scoreAction } from "@/server/actions/academic-index";
import { ACTIVITY_LEVELS, GRADE_SCALE, GRADE_SCALE_NOTE, MAX_ACTIVITIES, MAX_HONORS, MAX_SUPPLEMENTS, PERSONAL_STATEMENT_WORD_LIMIT, RIGOR_SELF_RATINGS } from "@/lib/academic-index/config";
import { removeListItem } from "@/lib/academic-index/extraction";
import { countWords } from "@/lib/academic-index/essays";
import { convertedGpa, validateInputs } from "@/lib/academic-index/score";
import type { AcademicInputs, FieldSource, FieldSources } from "@/lib/academic-index/inputs";

/**
 * The inputs form (spec section 4), which is also the review screen after a
 * PDF import (3.3): every field filled from a file shows where it came from;
 * low-confidence ones are highlighted and must be ticked; fields the PDFs
 * can't give are marked Needed.
 */

type Props = { initial: AcademicInputs; initialSources: FieldSources; keepEssays: boolean; essaysAvailable: boolean; review: boolean };

const numOrNull = (v: string, int = true) => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? (int ? Math.round(n) : n) : null;
};

export function InputsForm({ initial, initialSources, keepEssays: keepInitial, essaysAvailable, review }: Props) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [sources, setSources] = useState(initialSources);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [keepEssays, setKeepEssays] = useState(keepInitial);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"save" | "confirm" | "score" | null>(null);

  const needed = useMemo(() => validateInputs(v), [v]);
  const neededAt = (prefix: string) => needed.filter((n) => n.path === prefix || n.path.startsWith(`${prefix}.`));
  const unconfirmed = Object.entries(sources).filter(([, s]) => !s.confirmed);
  const lowLeft = unconfirmed.filter(([k, s]) => s.confidence === "low" && !ticked.has(k));
  const reviewing = unconfirmed.length > 0;

  const update = (fn: (x: AcademicInputs) => void) =>
    setV((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const removeItem = (list: string, n: number, fn: (x: AcademicInputs) => void) => {
    update(fn);
    setSources((s) => removeListItem(s, list, n));
    setTicked((t) => new Set([...t].filter((k) => !k.startsWith(`${list}.`))));
  };
  const payload = () => ({ inputs: v, sources, keepEssays });

  const act = (kind: "save" | "confirm" | "score") =>
    start(async () => {
      setBusy(kind);
      setMsg(kind === "score" ? { tone: "info", text: "Scoring… essays are read three times each, so this can take a minute." } : null);
      try {
        if (kind === "save") {
          const r = await saveDraftAction(payload());
          setMsg(r.ok ? { tone: "success", text: r.needed.length ? `Draft saved. ${r.needed.length} thing${r.needed.length === 1 ? "" : "s"} still needed before scoring.` : "Draft saved. Ready to score." } : { tone: "error", text: r.error });
        } else if (kind === "confirm") {
          const r = await confirmReviewAction({ ...payload(), ticked: [...ticked] });
          if (r.ok) {
            setSources((s) => Object.fromEntries(Object.entries(s).map(([k, x]) => [k, { ...x, confirmed: true }])));
            setMsg({ tone: "success", text: `Review confirmed.${r.deleted ? ` Your uploaded PDF${r.deleted === 1 ? " was" : "s were"} deleted; only the fields you confirmed are kept.` : ""}` });
            router.refresh();
          } else setMsg({ tone: "error", text: r.error });
        } else {
          const r = await scoreAction(payload());
          if (r.ok) router.push(`/academic-index/results/${r.resultId}`);
          else setMsg({ tone: "error", text: r.error });
        }
      } finally {
        setBusy(null);
      }
    });

  /** Where a field came from, with a tick box for low-confidence ones. */
  const src = (path: string) => {
    const s = sources[path];
    if (!s) return null;
    return <SourceNote source={s} ticked={ticked.has(path)} onTick={(on) => setTicked((t) => { const n = new Set(t); if (on) n.add(path); else n.delete(path); return n; })} />;
  };
  const isLow = (path: string) => sources[path] && !sources[path].confirmed && sources[path].confidence === "low" && !ticked.has(path);

  const t = v.testing;
  const g = v.grades;
  const r = v.rigor;
  const acts = v.activities.filter((a) => a.kind === "ACTIVITY").length;
  const honors = v.activities.length - acts;
  const converted = convertedGpa(g.courses);

  return (
    <div className="flex flex-col gap-6">
      {(review || reviewing) && reviewing && (
        <Alert tone="warning">
          <strong>Check every field filled in from your files.</strong> Each shows the file and page it came from. Fix anything that&apos;s wrong, type in anything marked Needed, and tick the {lowLeft.length > 0 ? `${lowLeft.length} highlighted field${lowLeft.length === 1 ? "" : "s"}` : "highlighted fields"} we weren&apos;t sure about. Then press <strong>Confirm review</strong>: your uploaded PDFs are deleted and only the confirmed fields are kept.
        </Alert>
      )}

      <Section title="1. Test scores" needed={neededAt("testing").length > 0}>
        <Field label="What are you reporting?" path="testing.type" source={src("testing.type")} needed={neededAt("testing.type")}>
          {(id) => (
            <select id={id} value={t.type ?? ""} onChange={(e) => update((x) => void (x.testing.type = (e.target.value || null) as AcademicInputs["testing"]["type"]))} className={inputClasses}>
              <option value="">Choose…</option>
              <option value="SAT">SAT</option>
              <option value="ACT">ACT</option>
              <option value="BOTH">Both SAT and ACT (whichever scores higher is used)</option>
              <option value="NONE">Test-optional (no scores)</option>
            </select>
          )}
        </Field>
        {(t.type === "SAT" || t.type === "BOTH") && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Add every test date: your best Reading and Writing and best Math are combined (superscore).</p>
            {t.satSittings.map((s, n) => (
              <div key={n} className={cn("flex flex-col gap-2 rounded-md border-[1.5px] border-border p-3", isLow(`testing.satSittings.${n}`) && "border-warning bg-warning-bg/40")}>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                  <Field label="Test date" path="">{(id) => <input id={id} value={s.date} maxLength={20} placeholder="e.g. March 2026" onChange={(e) => update((x) => void (x.testing.satSittings[n].date = e.target.value))} className={inputClasses} />}</Field>
                  <Field label="Reading and Writing" path="">{(id) => <input id={id} type="number" min={200} max={800} step={10} value={s.erw ?? ""} onChange={(e) => update((x) => void (x.testing.satSittings[n].erw = numOrNull(e.target.value)))} className={inputClasses} />}</Field>
                  <Field label="Math" path="">{(id) => <input id={id} type="number" min={200} max={800} step={10} value={s.math ?? ""} onChange={(e) => update((x) => void (x.testing.satSittings[n].math = numOrNull(e.target.value)))} className={inputClasses} />}</Field>
                  <Button size="sm" variant="ghost" onClick={() => removeItem("testing.satSittings", n, (x) => void x.testing.satSittings.splice(n, 1))}>Remove</Button>
                </div>
                {src(`testing.satSittings.${n}`)}
              </div>
            ))}
            {neededAt("testing.satSittings").map((x) => <NeededNote key={x.path + x.message}>{x.message}</NeededNote>)}
            {t.satSittings.length < 10 && (
              <div><Button size="sm" variant="secondary" onClick={() => update((x) => void x.testing.satSittings.push({ date: "", erw: null, math: null }))}>Add a test date</Button></div>
            )}
          </div>
        )}
        {(t.type === "ACT" || t.type === "BOTH") && (
          <Field label="ACT composite (1–36)" path="testing.actComposite" source={src("testing.actComposite")} needed={neededAt("testing.actComposite")} low={isLow("testing.actComposite")}>
            {(id) => <input id={id} type="number" min={1} max={36} value={t.actComposite ?? ""} onChange={(e) => update((x) => void (x.testing.actComposite = numOrNull(e.target.value)))} className={`${inputClasses} max-w-[8rem]`} />}
          </Field>
        )}
      </Section>

      <Section title="2. Grades" needed={neededAt("grades").length > 0}>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">How to enter grades</legend>
          <label className="flex items-center gap-2"><input type="radio" name="gmode" checked={g.mode === "GPA"} onChange={() => update((x) => void (x.grades.mode = "GPA"))} /> I know my unweighted GPA</label>
          <label className="flex items-center gap-2"><input type="radio" name="gmode" checked={g.mode === "COURSES"} onChange={() => update((x) => void (x.grades.mode = "COURSES"))} /> Convert my course grades (100-point scale)</label>
        </fieldset>
        {g.mode === "GPA" ? (
          <Field label="Unweighted GPA (0.00–4.00)" path="grades.unweightedGpa" hint="Unweighted, because course rigor is scored separately. If your school only reports a weighted GPA, ask your counselor or use the converter." source={src("grades.unweightedGpa")} needed={neededAt("grades.unweightedGpa")} low={isLow("grades.unweightedGpa")}>
            {(id) => <input id={id} type="number" min={0} max={4} step={0.01} value={g.unweightedGpa ?? ""} onChange={(e) => update((x) => void (x.grades.unweightedGpa = numOrNull(e.target.value, false)))} className={`${inputClasses} max-w-[8rem]`} />}
          </Field>
        ) : (
          <div className="flex flex-col gap-3">
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">How grades convert</summary>
              <table className="mt-2 text-xs">
                <thead><tr><th className="pr-4 text-left">Percent</th><th className="pr-4 text-left">Letter</th><th className="text-left">4.0 value</th></tr></thead>
                <tbody>
                  {GRADE_SCALE.map((s, i) => (
                    <tr key={s.letter}><td className="pr-4">{i === 0 ? "93–100" : s.min === 0 ? "Below 65" : `${s.min}–${GRADE_SCALE[i - 1].min - 1}`}</td><td className="pr-4">{s.letter}</td><td>{s.value.toFixed(1)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-muted">{GRADE_SCALE_NOTE}</p>
            </details>
            {g.courses.map((c, n) => (
              <div key={n} className={cn("grid gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end", isLow(`grades.courses.${n}`) && "rounded-md bg-warning-bg/40 p-2")}>
                <Field label="Course" path="">{(id) => <input id={id} value={c.name} maxLength={120} onChange={(e) => update((x) => void (x.grades.courses[n].name = e.target.value))} className={inputClasses} />}</Field>
                <Field label="Grade (percent or letter)" path="" needed={neededAt(`grades.courses.${n}`)}>{(id) => <input id={id} value={c.grade} maxLength={8} onChange={(e) => update((x) => void (x.grades.courses[n].grade = e.target.value))} className={inputClasses} />}</Field>
                <Button size="sm" variant="ghost" onClick={() => removeItem("grades.courses", n, (x) => void x.grades.courses.splice(n, 1))}>Remove</Button>
                <div className="sm:col-span-3">{src(`grades.courses.${n}`)}</div>
              </div>
            ))}
            <div><Button size="sm" variant="secondary" onClick={() => update((x) => void x.grades.courses.push({ name: "", grade: "" }))} disabled={g.courses.length >= 80}>Add a course</Button></div>
            {converted !== null && <p className="text-sm">Converted unweighted GPA: <strong>{converted.toFixed(2)}</strong></p>}
            {neededAt("grades.courses").filter((x) => x.path === "grades.courses").map((x) => <NeededNote key={x.message}>{x.message}</NeededNote>)}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={g.senior} onChange={(e) => update((x) => void (x.grades.senior = e.target.checked))} className="size-4" /> I&apos;m a senior (my GPA is mostly set)
        </label>
      </Section>

      <Section title="3. Course rigor" needed={neededAt("rigor").length > 0}>
        <p className="text-sm text-muted">AP, IB and dual-enrollment courses count 1 each; honors count 0.5. Your score compares what you took with what your school offers.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="AP / IB / dual-enrollment courses your school offers" path="rigor.offeredAdvanced" needed={!r.selfRating && !(r.offeredAdvanced || r.offeredHonors) ? neededAt("rigor") : []}>
            {(id) => <input id={id} type="number" min={0} max={100} value={r.offeredAdvanced ?? ""} onChange={(e) => update((x) => void (x.rigor.offeredAdvanced = numOrNull(e.target.value)))} className={inputClasses} />}
          </Field>
          <Field label="Honors courses your school offers" path="rigor.offeredHonors">
            {(id) => <input id={id} type="number" min={0} max={100} value={r.offeredHonors ?? ""} onChange={(e) => update((x) => void (x.rigor.offeredHonors = numOrNull(e.target.value)))} className={inputClasses} />}
          </Field>
          <Field label="AP / IB / dual-enrollment courses you've taken (or are taking)" path="rigor.takenAdvanced" source={src("rigor.takenAdvanced")} low={isLow("rigor.takenAdvanced")}>
            {(id) => <input id={id} type="number" min={0} max={100} value={r.takenAdvanced ?? ""} onChange={(e) => update((x) => void (x.rigor.takenAdvanced = numOrNull(e.target.value)))} className={inputClasses} />}
          </Field>
          <Field label="Honors courses you've taken" path="rigor.takenHonors" source={src("rigor.takenHonors")} low={isLow("rigor.takenHonors")}>
            {(id) => <input id={id} type="number" min={0} max={100} value={r.takenHonors ?? ""} onChange={(e) => update((x) => void (x.rigor.takenHonors = numOrNull(e.target.value)))} className={inputClasses} />}
          </Field>
        </div>
        {!(((r.offeredAdvanced ?? 0) + (r.offeredHonors ?? 0)) > 0) && (
          <Field label="Don't know what your school offers? Rate your schedule the way a counselor would" path="rigor.selfRating">
            {(id) => (
              <select id={id} value={r.selfRating ?? ""} onChange={(e) => update((x) => void (x.rigor.selfRating = e.target.value || null))} className={`${inputClasses} max-w-sm`}>
                <option value="">Choose…</option>
                {RIGOR_SELF_RATINGS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            )}
          </Field>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">AP and IB exam scores</h3>
          <p className="text-xs text-muted">Bonus: +1 for each AP 5 or IB 7, +0.5 for each AP 4 or IB 6 (up to 5).</p>
          {r.exams.map((e, n) => (
            <div key={n} className={cn("grid gap-2 sm:grid-cols-[2fr_6rem_6rem_auto] sm:items-end", isLow(`rigor.exams.${n}`) && "rounded-md bg-warning-bg/40 p-2")}>
              <Field label="Exam" path="">{(id) => <input id={id} value={e.name} maxLength={120} onChange={(ev) => update((x) => void (x.rigor.exams[n].name = ev.target.value))} className={inputClasses} />}</Field>
              <Field label="Type" path="">{(id) => <select id={id} value={e.kind} onChange={(ev) => update((x) => void (x.rigor.exams[n].kind = ev.target.value as "AP" | "IB"))} className={inputClasses}><option>AP</option><option>IB</option></select>}</Field>
              <Field label="Score" path="" needed={neededAt(`rigor.exams.${n}`)}>{(id) => <input id={id} type="number" min={1} max={e.kind === "AP" ? 5 : 7} value={e.score ?? ""} onChange={(ev) => update((x) => void (x.rigor.exams[n].score = numOrNull(ev.target.value)))} className={inputClasses} />}</Field>
              <Button size="sm" variant="ghost" onClick={() => removeItem("rigor.exams", n, (x) => void x.rigor.exams.splice(n, 1))}>Remove</Button>
              <div className="sm:col-span-4">{src(`rigor.exams.${n}`)}</div>
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => update((x) => void x.rigor.exams.push({ name: "", kind: "AP", score: null }))} disabled={r.exams.length >= 40}>Add an exam</Button></div>
        </div>
      </Section>

      <Section title="4. Activities and honors" needed={neededAt("activities").length > 0}>
        <p className="text-sm text-muted">Up to {MAX_ACTIVITIES} activities and {MAX_HONORS} honors. Your three highest count. Choose the highest level each one reached; +1 for a real leadership role (founder, president, captain, editor).</p>
        {v.activities.map((a, n) => (
          <div key={n} className={cn("flex flex-col gap-2 rounded-md border-[1.5px] border-border p-3", (isLow(`activities.${n}`) || isLow(`activities.${n}.level`)) && "border-warning bg-warning-bg/40")}>
            <div className="grid gap-2 sm:grid-cols-[6rem_2fr_1.5fr_auto] sm:items-end">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted sm:pb-3">{a.kind === "HONOR" ? "Honor" : "Activity"}</span>
              <Field label="Name" path="">{(id) => <input id={id} value={a.name} maxLength={200} onChange={(e) => update((x) => void (x.activities[n].name = e.target.value))} className={inputClasses} />}</Field>
              <Field label="Highest level reached" path={`activities.${n}.level`} needed={neededAt(`activities.${n}.level`)}>
                {(id) => (
                  <select id={id} value={a.level ?? ""} onChange={(e) => update((x) => void (x.activities[n].level = e.target.value || null))} className={inputClasses}>
                    <option value="">Choose…</option>
                    {ACTIVITY_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select>
                )}
              </Field>
              <Button size="sm" variant="ghost" onClick={() => removeItem("activities", n, (x) => void x.activities.splice(n, 1))}>Remove</Button>
            </div>
            {a.kind === "ACTIVITY" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.leadership} onChange={(e) => update((x) => void (x.activities[n].leadership = e.target.checked))} className="size-4" /> Leadership role</label>
            )}
            {src(`activities.${n}`)}
            {sources[`activities.${n}.level`] && (
              <div className="text-xs">
                <span className="text-muted">{a.kind === "ACTIVITY" ? "Level suggested by Coursebook (the Common App doesn't record it). " : "Level from the Common App's recognition level. "}</span>
                {src(`activities.${n}.level`)}
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={acts >= MAX_ACTIVITIES} onClick={() => update((x) => void x.activities.splice(acts, 0, { kind: "ACTIVITY", name: "", type: "", level: null, leadership: false }))}>Add an activity</Button>
          <Button size="sm" variant="secondary" disabled={honors >= MAX_HONORS} onClick={() => update((x) => void x.activities.push({ kind: "HONOR", name: "", type: "", level: null, leadership: false }))}>Add an honor</Button>
        </div>
      </Section>

      <Section title="5. Essays">
        {!essaysAvailable && <Alert tone="info">Essay scoring isn&apos;t available on your account, so your index will be a partial estimate without essays.</Alert>}
        <EssayBox label="Personal statement" limit={PERSONAL_STATEMENT_WORD_LIMIT} value={v.essays.personalStatement} onChange={(text) => update((x) => void (x.essays.personalStatement = text))} source={src("essays.personalStatement")} low={isLow("essays.personalStatement")} />
        {v.essays.supplements.map((s, n) => (
          <div key={n} className={cn("flex flex-col gap-2 rounded-md border-[1.5px] border-border p-3", isLow(`essays.supplements.${n}`) && "border-warning bg-warning-bg/40")}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Supplement {n + 1}</h3><Button size="sm" variant="ghost" onClick={() => removeItem("essays.supplements", n, (x) => void x.essays.supplements.splice(n, 1))}>Remove</Button></div>
            <Field label="Prompt" path="">{(id) => <textarea id={id} rows={2} maxLength={2000} value={s.prompt} onChange={(e) => update((x) => void (x.essays.supplements[n].prompt = e.target.value))} className={`${inputClasses} h-auto py-2`} />}</Field>
            <Field label="Word limit" path="">{(id) => <input id={id} type="number" min={1} max={5000} value={s.wordLimit ?? ""} onChange={(e) => update((x) => void (x.essays.supplements[n].wordLimit = numOrNull(e.target.value)))} className={`${inputClasses} max-w-[8rem]`} />}</Field>
            <EssayBox label="Essay" limit={s.wordLimit} value={s.text} onChange={(text) => update((x) => void (x.essays.supplements[n].text = text))} />
            {src(`essays.supplements.${n}`)}
          </div>
        ))}
        <div><Button size="sm" variant="secondary" disabled={v.essays.supplements.length >= MAX_SUPPLEMENTS} onClick={() => update((x) => void x.essays.supplements.push({ prompt: "", wordLimit: null, text: "" }))}>Add a supplemental essay</Button></div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={keepEssays} onChange={(e) => setKeepEssays(e.target.checked)} className="mt-0.5 size-4" />
          <span>Keep my essays saved here so I can come back to them. If this is off, your essays are scored but not stored (only the scores and feedback are). They&apos;re never used to train anything.</span>
        </label>
      </Section>

      <Card className="sticky bottom-3 z-10 flex flex-col gap-3 p-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {needed.length > 0 && !reviewing && <p className="text-sm text-muted">{needed.length} thing{needed.length === 1 ? "" : "s"} still needed: {needed[0].message}</p>}
        <div className="flex flex-wrap gap-2">
          {reviewing ? (
            <Button onClick={() => act("confirm")} disabled={pending || lowLeft.length > 0}>{busy === "confirm" ? "Confirming…" : lowLeft.length ? `Tick ${lowLeft.length} highlighted field${lowLeft.length === 1 ? "" : "s"} to confirm` : "Confirm review"}</Button>
          ) : (
            <Button onClick={() => act("score")} disabled={pending || needed.length > 0}>{busy === "score" ? "Scoring…" : "Score my application"}</Button>
          )}
          <Button variant="secondary" onClick={() => act("save")} disabled={pending}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children, needed }: { title: string; children: ReactNode; needed?: boolean }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        {title}
        {needed && <span className="rounded-sm bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">Needed</span>}
      </h2>
      {children}
    </Card>
  );
}

function NeededNote({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium text-warning">Needed: {children}</p>;
}

function Field({ label, hint, children, source, needed = [], low }: { label: string; path: string; hint?: string; children: (id: string) => ReactNode; source?: ReactNode; needed?: { message: string }[]; low?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", low && "rounded-md bg-warning-bg/40 p-2")}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children(id)}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {source}
      {needed.map((n) => <NeededNote key={n.message}>{n.message}</NeededNote>)}
    </div>
  );
}

function SourceNote({ source, ticked, onTick }: { source: FieldSource; ticked: boolean; onTick: (on: boolean) => void }) {
  const where = `${source.fileLabel}${source.page ? `, page ${source.page}` : ""}`;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted">
        From {where}
        {source.confirmed ? " · checked" : ""}
      </span>
      {source.alternative && (
        <span className="text-warning">
          Your files disagree: {source.alternative.fileLabel}{source.alternative.page ? ` (page ${source.alternative.page})` : ""} says {source.alternative.value}. The {source.fileLabel} value is used.
        </span>
      )}
      {!source.confirmed && source.confidence === "low" && (
        <label className="flex items-center gap-2 font-semibold text-warning">
          <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} className="size-4" />
          We weren&apos;t sure about this. I&apos;ve checked it.
        </label>
      )}
    </div>
  );
}

function EssayBox({ label, limit, value, onChange, source, low }: { label: string; limit: number | null; value: string; onChange: (t: string) => void; source?: ReactNode; low?: boolean }) {
  const id = useId();
  const words = countWords(value);
  const over = limit !== null && words > limit;
  return (
    <div className={cn("flex flex-col gap-1.5", low && "rounded-md bg-warning-bg/40 p-2")}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <textarea id={id} rows={10} maxLength={30_000} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClasses} h-auto py-2 leading-relaxed`} />
      <p className={cn("text-xs", over ? "font-semibold text-warning" : "text-muted")}>
        {words} words{limit ? ` of ${limit}` : ""}{over ? ": over the limit costs a point on Clarity & mechanics" : ""}
      </p>
      {source}
    </div>
  );
}
