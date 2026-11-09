"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveSettingsAction } from "@/server/actions/outline";
import { CONTENT_TYPES, LEVELS, STYLES, type ContentType, type CourseSettings } from "@/lib/course/settings";
import { estimateGeneration, type EstimateLesson } from "@/lib/usage/estimate";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Props = {
  courseId: string;
  initial: CourseSettings;
  lessons: { normal: EstimateLesson[]; frontBack: EstimateLesson[]; skippedNormal: number };
};

const usd = (n: number) => (n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

function Fieldset({ legend, hint, children }: { legend: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-base font-semibold">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Choice({ name, value, checked, onChange, title, description }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; description?: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
        checked ? "border-primary bg-surface-2" : "border-border bg-surface hover:bg-surface-2",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        <span className="font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function SettingsForm({ courseId, initial, lessons }: Props) {
  const router = useRouter();
  const [s, setS] = useState<CourseSettings>(initial);
  const [savedJson, setSavedJson] = useState(JSON.stringify(initial));
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(s) !== savedJson;

  const update = (patch: Partial<CourseSettings>) => {
    setMsg(null);
    setS((prev) => ({ ...prev, ...patch }));
  };
  const toggleType = (t: ContentType) =>
    update({ contentTypes: s.contentTypes.includes(t) ? s.contentTypes.filter((x) => x !== t) : [...s.contentTypes, t] });

  const included = useMemo(
    () => (s.includeFrontBackMatter ? [...lessons.normal, ...lessons.frontBack] : lessons.normal),
    [s.includeFrontBackMatter, lessons],
  );
  const estimate = useMemo(() => estimateGeneration(included, s), [included, s]);
  const anyQuestions = s.contentTypes.some((t) => t === "multipleChoice" || t === "shortAnswer" || t === "stepProblems");

  function save() {
    startTransition(async () => {
      const res = await saveSettingsAction(courseId, s);
      if (!res.ok) {
        setMsg({ tone: "error", text: res.error });
        return;
      }
      setS(res.settings);
      setSavedJson(JSON.stringify(res.settings));
      setMsg({ tone: "success", text: "Settings saved." });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <form
        className="flex flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Fieldset legend="Student level" hint="Sets the reading level and how much background is explained.">
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(LEVELS) as (keyof typeof LEVELS)[]).map((k) => (
              <Choice key={k} name="level" value={k} checked={s.level === k} onChange={() => update({ level: k })} title={LEVELS[k]} />
            ))}
          </div>
        </Fieldset>

        <Fieldset legend="Explanation style">
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(STYLES) as (keyof typeof STYLES)[]).map((k) => (
              <Choice key={k} name="style" value={k} checked={s.style === k} onChange={() => update({ style: k })} title={STYLES[k].label} description={STYLES[k].description} />
            ))}
          </div>
        </Fieldset>

        <Fieldset legend="What to create" hint="Every lesson always gets an explanation written from its pages. Choose what else to add.">
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {(Object.keys(CONTENT_TYPES) as ContentType[]).map((t) => (
              <label key={t} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={s.contentTypes.includes(t)} onChange={() => toggleType(t)} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>
                  {CONTENT_TYPES[t].label}
                  {CONTENT_TYPES[t].scope !== "lesson" && <span className="text-muted"> (per {CONTENT_TYPES[t].scope})</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label className={cn("flex flex-col gap-1.5 text-sm", !anyQuestions && "opacity-50")}>
              <span className="font-medium">Practice questions per lesson: {s.questionsPerLesson}</span>
              <input type="range" min={2} max={15} value={s.questionsPerLesson} disabled={!anyQuestions} onChange={(e) => update({ questionsPerLesson: Number(e.target.value) })} className="accent-[var(--primary)]" />
            </label>
            <label className={cn("flex flex-col gap-1.5 text-sm", !s.contentTypes.includes("flashcards") && "opacity-50")}>
              <span className="font-medium">Flashcards per lesson: {s.flashcardsPerLesson}</span>
              <input
                type="range"
                min={0}
                max={25}
                value={s.flashcardsPerLesson}
                disabled={!s.contentTypes.includes("flashcards")}
                onChange={(e) => update({ flashcardsPerLesson: Number(e.target.value) })}
                className="accent-[var(--primary)]"
              />
            </label>
          </div>
        </Fieldset>

        <Fieldset legend="Front and back matter">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.includeFrontBackMatter}
              onChange={(e) => update({ includeFrontBackMatter: e.target.checked })}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              Include pages like the preface, contents, glossary and index ({lessons.frontBack.length}{" "}
              {lessons.frontBack.length === 1 ? "lesson" : "lessons"}). Usually not worth studying.
            </span>
          </label>
        </Fieldset>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
          {dirty && !pending && <span className="text-sm text-warning">Unsaved changes</span>}
        </div>
      </form>

      <aside aria-labelledby="estimate-title" className="lg:sticky lg:top-20 lg:self-start">
        <Card className="p-5">
          <h2 id="estimate-title" className="font-semibold">
            Estimate
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Lessons</dt>
              <dd className="text-lg font-semibold tabular-nums">{estimate.lessons}</dd>
            </div>
            <div>
              <dt className="text-muted">Pages</dt>
              <dd className="text-lg font-semibold tabular-nums">{estimate.pages}</dd>
            </div>
            <div>
              <dt className="text-muted">API cost</dt>
              <dd className="text-lg font-semibold tabular-nums">≈ {usd(estimate.costUsd)}</dd>
            </div>
            <div>
              <dt className="text-muted">Time</dt>
              <dd className="text-lg font-semibold tabular-nums">≈ {estimate.minutes} min</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            A rough guess from the amount of text and your choices, using Claude Sonnet 5.5. Lessons can be studied as soon as
            each one is ready.
            {lessons.skippedNormal > 0 &&
              ` ${lessons.skippedNormal} ${lessons.skippedNormal === 1 ? "lesson you skipped isn't" : "lessons you skipped aren't"} counted.`}
          </p>
          <Button className="mt-4 w-full" disabled title="Lesson generation is built in the next phase">
            Generate course
          </Button>
          <p className="mt-2 text-center text-xs text-muted">Lesson generation arrives in the next build phase.</p>
        </Card>
      </aside>
    </div>
  );
}
