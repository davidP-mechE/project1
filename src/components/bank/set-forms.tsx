"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { autoSetAction, createSetAction, deleteSetAction, findQuestionsAction, setSetStatusAction, updateSetAction } from "@/server/actions/bank";
import { cn } from "@/lib/utils";

type Skill = { id: string; section: string; domain: string; name: string };
type Q = { id: string; externalId: string | null; stem: string; status: string; difficulty: number; type: string; skill: { name: string } | null };

const plain = (s: string) => s.replace(/\$+/g, "").replace(/\s+/g, " ").trim().slice(0, 110);

export function NewSetForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createSetAction({ title, questionIds: [] });
          if (!r.ok) return setError(r.error);
          router.push(`/bank/sets/${r.setId}`);
        });
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Title
        <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <Button disabled={pending}>Create set</Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

/** "10 questions, skill X, difficulty 2–3". */
export function AutoSetForm({ skills }: { skills: Skill[] }) {
  const router = useRouter();
  const [v, setV] = useState({ count: 10, skillId: "", difficultyMin: 2, difficultyMax: 3, type: "", publishedOnly: false, title: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await autoSetAction({ ...v, skillId: v.skillId || null, type: v.type || null, title: v.title || undefined });
          if (!r.ok) return setError(r.error);
          router.push(`/bank/sets/${r.setId}`);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        How many
        <input type="number" min={1} max={100} className={inputClasses} value={v.count} onChange={(e) => setV({ ...v, count: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
        Skill
        <select className={inputClasses} value={v.skillId} onChange={(e) => setV({ ...v, skillId: e.target.value })}>
          <option value="">Any skill</option>
          {skills.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Difficulty from
        <select className={inputClasses} value={v.difficultyMin} onChange={(e) => setV({ ...v, difficultyMin: Number(e.target.value) })}>
          {[1, 2, 3].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        to
        <select className={inputClasses} value={v.difficultyMax} onChange={(e) => setV({ ...v, difficultyMax: Number(e.target.value) })}>
          {[1, 2, 3].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Type
        <select className={inputClasses} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
          <option value="">Any</option>
          <option value="mcq">Multiple choice</option>
          <option value="grid_in">Grid-in</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={v.publishedOnly} onChange={(e) => setV({ ...v, publishedOnly: e.target.checked })} /> Published questions only
      </label>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button disabled={pending}>Generate set</Button>
      </div>
      {error && <Alert tone="error" className="sm:col-span-2 lg:col-span-6">{error}</Alert>}
    </form>
  );
}

/** Edit a set: title, visibility, time limit, its questions (add by id, reorder, remove), and publishing. */
export function SetEditor({ set }: { set: { id: string; title: string; description: string | null; visibility: "private" | "class" | "public"; status: "draft" | "published"; timeLimitMin: number | null; questions: Q[] } }) {
  const router = useRouter();
  const [title, setTitle] = useState(set.title);
  const [description, setDescription] = useState(set.description ?? "");
  const [visibility, setVisibility] = useState(set.visibility);
  const [limit, setLimit] = useState(set.timeLimitMin ? String(set.timeLimitMin) : "");
  const [qs, setQs] = useState<Q[]>(set.questions);
  const [refs, setRefs] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "warning"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const drafts = qs.filter((q) => q.status !== "published").length;

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    setQs(next);
  };
  const save = () =>
    start(async () => {
      const r = await updateSetAction(set.id, { title, description, visibility, timeLimitMin: limit ? Number(limit) : null, questionIds: qs.map((q) => q.id) });
      setMsg(r.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });
  const add = () =>
    start(async () => {
      const r = await findQuestionsAction(refs);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      const have = new Set(qs.map((q) => q.id));
      setQs([...qs, ...r.questions.filter((q) => !have.has(q.id))]);
      setRefs("");
      setMsg(r.missing.length ? { tone: "warning", text: `Not found: ${r.missing.join(", ")}. Save to keep the others.` } : { tone: "success", text: `Added ${r.questions.length}. Save to keep them.` });
    });
  const status = (s: "draft" | "published", withQuestions = false) =>
    start(async () => {
      const r = await setSetStatusAction(set.id, s, withQuestions);
      setMsg(r.ok ? { tone: "success", text: s === "published" ? "Published." : "Back to draft." } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Title
          <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Who can play it
          <select className={inputClasses} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
            <option value="private">Only authors (private)</option>
            <option value="class">Classes it&apos;s assigned to</option>
            <option value="public">Every student (once published)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Time limit for timed play (minutes)
          <input type="number" min={1} max={300} className={inputClasses} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="About 1.6 min per question" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2 lg:col-span-4">
          Description (optional)
          <input className={inputClasses} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          Add questions by id
          <input className={inputClasses} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder="W3-01, W3-02 …" />
        </label>
        <Button type="button" variant="secondary" disabled={pending || !refs.trim()} onClick={add}>
          Add
        </Button>
      </div>
      {drafts > 0 && <Alert tone="warning">{drafts} of these questions are drafts. Students only see published questions, so they won&apos;t appear until they&apos;re published.</Alert>}
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {qs.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No questions yet.</li>}
        {qs.map((q, i) => (
          <li key={q.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
            <span className="w-8 text-xs tabular-nums text-muted">{i + 1}.</span>
            <a href={`/bank/${q.id}`} className="w-16 font-mono text-xs underline">{q.externalId ?? "open"}</a>
            <span className="min-w-0 flex-1 truncate text-sm">{plain(q.stem)}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", q.status === "published" ? "bg-success-bg text-success" : "bg-surface-2")}>{q.status}</span>
            <span className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)}>↑</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)}>↓</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => setQs(qs.filter((x) => x.id !== q.id))}>Remove</Button>
            </span>
          </li>
        ))}
      </ol>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={save}>Save set</Button>
        <ButtonLink href={`/practice/${set.id}`} variant="secondary">Preview in the player</ButtonLink>
        {set.status === "draft" ? (
          <>
            <Button disabled={pending} variant="secondary" onClick={() => status("published")}>Publish set</Button>
            {drafts > 0 && <Button disabled={pending} variant="secondary" onClick={() => confirm(`Publish this set and its ${drafts} draft questions?`) && status("published", true)}>Publish set and its {drafts} draft questions</Button>}
          </>
        ) : (
          <Button disabled={pending} variant="secondary" onClick={() => status("draft")}>Unpublish set</Button>
        )}
        <Button
          disabled={pending}
          variant="danger"
          className="ml-auto"
          onClick={() =>
            confirm("Delete this set? Its questions stay in the bank.") &&
            start(async () => {
              const r = await deleteSetAction(set.id);
              if (!r.ok) return setMsg({ tone: "error", text: r.error });
              router.push("/bank/sets");
            })
          }
        >
          Delete set
        </Button>
      </div>
    </div>
  );
}
