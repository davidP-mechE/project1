"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { AgeGate } from "@/components/age-gate";

type Pattern = { key: string; theme: string; status: "new" | "confirmed" | "rejected"; question: string; evidence: string; feelings: { label: string; count: number }[]; episodes: { id: string; date: string; event: string }[] };
type View = { tier: string; patterns: Pattern[]; lockedCount: number; building: number };

export default function PatternsPage() {
  const { me, reload } = useMe();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<View>("/api/patterns").then(setView, (e) => setError(e.message)), []);
  useEffect(() => {
    if (me?.user?.ageConfirmed) load();
  }, [me?.user?.ageConfirmed, load]);

  if (!me) return <main className="wrap page muted">Loading…</main>;
  if (!me.user?.ageConfirmed) return <main className="wrap"><AgeGate onDone={reload} /></main>;

  return (
    <main className="wrap page">
      <h1>My patterns</h1>
      <p className="lede">A pattern only shows up here once at least three episodes support it, two of them with a cause you confirmed, across more than one situation. Each one is a working idea you can confirm, reword or reject.</p>
      {error && <p className="note help">{error}</p>}
      {view && view.patterns.length === 0 && (
        <p className="note plain">
          Nothing here yet{view.building ? `: ${view.building} possible connection${view.building === 1 ? " is" : "s are"} still waiting for enough evidence` : ""}. Patterns come from finished sessions, so the more you <Link href="/talk">talk things through</Link>, the more there is to connect.
        </p>
      )}
      {view?.patterns.map((p) => <PatternEntry key={p.key} p={p} onChange={load} />)}
      {view && view.lockedCount > 0 && (
        <p className="note">
          {view.lockedCount} more pattern{view.lockedCount === 1 ? "" : "s"} connect to earlier sessions. Free accounts see one new pattern a month; Plus shows the full map and the history behind each one.
        </p>
      )}
    </main>
  );
}

function PatternEntry({ p, onChange }: { p: Pattern; onChange: () => void }) {
  const [rewording, setRewording] = useState(false);
  const [wording, setWording] = useState(p.theme);
  const act = async (action: "confirm" | "reject" | "reword") => {
    await api("/api/patterns", { body: { key: p.key, action, wording: action === "reword" ? wording : undefined } });
    setRewording(false);
    onChange();
  };
  return (
    <article className="entry">
      <h3>{p.theme}</h3>
      {p.status === "new" ? <p>{p.question}</p> : <p className="tag">{p.status === "confirmed" ? "You confirmed this." : "You rejected this; it won't come back unless new episodes support it."}</p>}
      <p className="evidence">Why this shows up: {p.evidence}. Feelings most often in the mix: {p.feelings.map((f) => f.label).join(", ")}.</p>
      <ul className="episode-list">
        {p.episodes.map((e) => (
          <li key={e.id}>
            <span className="tag">{e.date}</span> {e.event}
          </li>
        ))}
      </ul>
      {rewording ? (
        <form className="row" onSubmit={(e) => (e.preventDefault(), act("reword"))}>
          <label className="sr-only" htmlFor={`w-${p.key}`}>Your wording</label>
          <input id={`w-${p.key}`} type="text" value={wording} onChange={(e) => setWording(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn">Save wording</button>
          <button type="button" className="link-btn" onClick={() => setRewording(false)}>Cancel</button>
        </form>
      ) : (
        p.status !== "rejected" && (
          <div className="row">
            {p.status === "new" && <button className="btn" onClick={() => act("confirm")}>That rings true</button>}
            <button className="btn quiet" onClick={() => setRewording(true)}>Reword it</button>
            <button className="btn quiet" onClick={() => act("reject")}>That&apos;s not it</button>
          </div>
        )
      )}
    </article>
  );
}
