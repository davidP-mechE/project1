"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { deleteQuestionAction, saveQuestionAction } from "@/server/actions/bank";
import { DESMOS_TECHNIQUES } from "@/lib/bank/import";
import { cn } from "@/lib/utils";

export type EditorRecord = {
  external_id: string;
  section: string;
  skill: string;
  difficulty: number;
  type: string;
  stem: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  choice_d: string;
  answer: string;
  answer_text: string;
  explanation: string;
  distractor_notes: Record<string, string>;
  week: number | string;
  lesson: string;
  unit: string;
  focus: string;
  blueprint: string;
  desmos_technique: string;
  image_url: string;
};

export const EMPTY_RECORD: EditorRecord = {
  external_id: "",
  section: "math",
  skill: "",
  difficulty: 2,
  type: "mcq",
  stem: "",
  choice_a: "",
  choice_b: "",
  choice_c: "",
  choice_d: "",
  answer: "A",
  answer_text: "",
  explanation: "",
  distractor_notes: {},
  week: "",
  lesson: "",
  unit: "",
  focus: "",
  blueprint: "",
  desmos_technique: "",
  image_url: "",
};

type Skill = { id: string; section: string; domain: string; name: string };
const LETTERS = ["A", "B", "C", "D"] as const;
const CHOICE_KEY = { A: "choice_a", B: "choice_b", C: "choice_c", D: "choice_d" } as const;

function Labeled({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm font-medium", className)}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Write or edit a bank question: stem with a Markdown + LaTeX preview, four
 * choices or a grid-in answer, explanation, a "likely mistake" note for each
 * wrong choice (or wrong value), skill, difficulty and an optional image.
 * Editing a published question saves a new version; old attempts keep theirs.
 */
export function QuestionEditor({ questionId, initial, status, version, skills, desmosSlot }: { questionId: string | null; initial: EditorRecord; status: "draft" | "published"; version: number; skills: Skill[]; desmosSlot?: ReactNode }) {
  const router = useRouter();
  const [r, setR] = useState<EditorRecord>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [gridNotes, setGridNotes] = useState<{ value: string; note: string }[]>(() =>
    initial.type === "grid-in" ? Object.entries(initial.distractor_notes).map(([value, note]) => ({ value, note })) : [],
  );
  const set = <K extends keyof EditorRecord>(k: K, v: EditorRecord[K]) => {
    setSaved(null);
    setR((x) => ({ ...x, [k]: v }));
  };
  const mcq = r.type === "mcq";
  const sectionSkills = skills.filter((s) => s.section === r.section);
  const domains = [...new Set(sectionSkills.map((s) => s.domain))];

  const payload = () => ({
    ...r,
    distractor_notes: mcq
      ? Object.fromEntries(Object.entries(r.distractor_notes).filter(([k, v]) => k !== r.answer && v.trim()))
      : Object.fromEntries(gridNotes.filter((g) => g.value.trim() && g.note.trim()).map((g) => [g.value.trim(), g.note.trim()])),
  });

  const save = (mode: "draft" | "publish" | "keep") =>
    start(async () => {
      setError(null);
      const res = await saveQuestionAction(questionId, payload(), mode);
      if (!res.ok) return setError(res.error);
      setSaved(res.status === "published" ? `Saved and published (version ${res.version}).` : "Saved as a draft.");
      if (!questionId) router.push(`/bank/${res.questionId}`);
      else router.refresh();
    });

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/bank/images", { method: "POST", body });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed.");
      set("image_url", json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {status === "published" && <Alert tone="info">This question is published (version {version}). Saving changes to its content makes version {version + 1}; students&apos; past answers stay on the version they saw.</Alert>}
      <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Labeled label="Id (optional)" hint="Your own reference, e.g. W3-01">
          <input className={inputClasses} value={r.external_id} maxLength={64} onChange={(e) => set("external_id", e.target.value)} />
        </Labeled>
        <Labeled label="Section">
          <select className={inputClasses} value={r.section} onChange={(e) => (set("section", e.target.value), set("skill", ""))}>
            <option value="math">Math</option>
            <option value="rw">Reading and Writing</option>
          </select>
        </Labeled>
        <Labeled label="Skill" className="sm:col-span-2">
          <select className={inputClasses} value={r.skill} onChange={(e) => set("skill", e.target.value)} required>
            <option value="">Choose a skill…</option>
            {domains.map((d) => (
              <optgroup key={d} label={d}>
                {sectionSkills
                  .filter((s) => s.domain === d)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Labeled>
        <Labeled label="Difficulty">
          <select className={inputClasses} value={r.difficulty} onChange={(e) => set("difficulty", Number(e.target.value))}>
            <option value={1}>1 · easier</option>
            <option value={2}>2 · medium</option>
            <option value={3}>3 · harder</option>
          </select>
        </Labeled>
        <Labeled label="Type">
          <select className={inputClasses} value={r.type} onChange={(e) => set("type", e.target.value)}>
            <option value="mcq">Multiple choice</option>
            <option value="grid-in">Grid-in</option>
          </select>
        </Labeled>
        <Labeled label="Week">
          <input className={inputClasses} type="number" min={0} max={99} value={r.week} onChange={(e) => set("week", e.target.value)} />
        </Labeled>
        <Labeled label="Lesson">
          <input className={inputClasses} value={r.lesson} maxLength={40} onChange={(e) => set("lesson", e.target.value)} />
        </Labeled>
        <Labeled label="Unit" className="sm:col-span-2">
          <input className={inputClasses} value={r.unit} maxLength={200} onChange={(e) => set("unit", e.target.value)} />
        </Labeled>
        <Labeled label="Focus">
          <input className={inputClasses} value={r.focus} maxLength={200} onChange={(e) => set("focus", e.target.value)} />
        </Labeled>
        <Labeled label="Blueprint">
          <input className={inputClasses} value={r.blueprint} maxLength={40} onChange={(e) => set("blueprint", e.target.value)} />
        </Labeled>
      </Card>

      <Card className="grid gap-4 lg:grid-cols-2">
        <Labeled label="Question" hint="Markdown and LaTeX ($x^2$, $$\frac{a}{b}$$). Tables: | x | 0 | 4 |">
          <textarea className={cn(inputClasses, "h-48 py-2 font-mono")} value={r.stem} onChange={(e) => set("stem", e.target.value)} />
        </Labeled>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Preview</p>
          <div className="min-h-48 overflow-x-auto rounded-md border border-border bg-surface-2 p-3" aria-live="polite">
            {r.stem.trim() ? <Markdown>{r.stem}</Markdown> : <p className="text-sm text-muted">The question appears here as students will see it.</p>}
            {r.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image_url} alt="Question figure" className="mt-3 max-h-64 rounded border border-border" />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:col-span-2">
          <p className="text-sm font-medium">Image (optional)</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload an image" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
            {r.image_url && (
              <Button type="button" size="sm" variant="ghost" onClick={() => set("image_url", "")}>
                Remove image
              </Button>
            )}
            {uploading && <span className="text-sm text-muted">Uploading…</span>}
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        {mcq ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">Choices (select the correct one) and the likely mistake behind each wrong one</legend>
            {LETTERS.map((L) => (
              <div key={L} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" name="correct" checked={r.answer === L} onChange={() => set("answer", L)} />
                  {L}
                </label>
                <input className={inputClasses} aria-label={`Choice ${L}`} value={r[CHOICE_KEY[L]]} onChange={(e) => set(CHOICE_KEY[L], e.target.value)} />
                {r.answer === L ? (
                  <p className="text-sm font-semibold text-success">Correct answer</p>
                ) : (
                  <input
                    className={inputClasses}
                    aria-label={`Likely mistake for ${L}`}
                    placeholder="Likely mistake behind this choice"
                    value={r.distractor_notes[L] ?? ""}
                    onChange={(e) => set("distractor_notes", { ...r.distractor_notes, [L]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <Labeled label="Answer text (optional)" hint="The correct value in words or numbers, shown with the letter.">
              <input className={inputClasses} value={r.answer_text} onChange={(e) => set("answer_text", e.target.value)} />
            </Labeled>
          </fieldset>
        ) : (
          <div className="flex flex-col gap-3">
            <Labeled label="Correct answer" hint='A number or fraction. Equivalent forms are accepted automatically (3/4 = 0.75). Separate several accepted answers with "|".'>
              <input className={cn(inputClasses, "max-w-xs")} value={r.answer} onChange={(e) => set("answer", e.target.value)} />
            </Labeled>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Likely wrong values and the mistake behind each</legend>
              {gridNotes.map((g, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                  <input className={inputClasses} aria-label={`Wrong value ${i + 1}`} value={g.value} onChange={(e) => setGridNotes(gridNotes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <input className={inputClasses} aria-label={`Mistake for wrong value ${i + 1}`} value={g.note} onChange={(e) => setGridNotes(gridNotes.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setGridNotes(gridNotes.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" size="sm" variant="secondary" onClick={() => setGridNotes([...gridNotes, { value: "", note: "" }])}>
                  Add a wrong value
                </Button>
              </div>
            </fieldset>
          </div>
        )}
      </Card>

      <Card className="grid gap-4 lg:grid-cols-2">
        <Labeled label="Explanation" hint="Shown after the student answers.">
          <textarea className={cn(inputClasses, "h-36 py-2 font-mono")} value={r.explanation} onChange={(e) => set("explanation", e.target.value)} />
        </Labeled>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Preview</p>
          <div className="min-h-36 rounded-md border border-border bg-surface-2 p-3">{r.explanation.trim() ? <Markdown>{r.explanation}</Markdown> : <p className="text-sm text-muted">No explanation yet.</p>}</div>
        </div>
        <Labeled label="Desmos technique (optional)" hint="Links the question to the matching Desmos Toolkit lesson once it's published.">
          <select className={inputClasses} value={r.desmos_technique} onChange={(e) => set("desmos_technique", e.target.value)}>
            <option value="">None</option>
            {DESMOS_TECHNIQUES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Labeled>
      </Card>

      {desmosSlot}

      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}
      <div className="sticky bottom-16 z-10 flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-3 shadow-sm lg:bottom-2">
        {status === "published" ? (
          <>
            <Button disabled={pending} onClick={() => save("keep")}>Save (new version)</Button>
            <Button disabled={pending} variant="secondary" onClick={() => save("draft")}>Unpublish</Button>
          </>
        ) : (
          <>
            <Button disabled={pending} variant="secondary" onClick={() => save("draft")}>Save draft</Button>
            <Button disabled={pending} onClick={() => save("publish")}>Publish</Button>
          </>
        )}
        {questionId && status === "draft" && (
          <Button
            disabled={pending}
            variant="danger"
            className="ml-auto"
            onClick={() =>
              confirm("Delete this draft question?") &&
              start(async () => {
                const res = await deleteQuestionAction(questionId);
                if (!res.ok) return setError(res.error);
                router.push("/bank");
              })
            }
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
