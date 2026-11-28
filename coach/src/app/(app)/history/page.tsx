"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { AgeGate } from "@/components/age-gate";

type Item = { id: string; date: string; crisis: boolean; summary: string | null; episodes: { id: string; event: string; feelings: string[]; people: string[]; confirmed: string[]; plan: string | null; outcome: string | null }[] };

const OUTCOME: Record<string, string> = { tried_helped: "You tried it, and it helped.", tried_mixed: "You tried it; mixed results.", tried_didnt_help: "You tried it; it didn't help.", not_tried: "You didn't get to try it." };

export default function HistoryPage() {
  const { me, reload } = useMe();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    if (!me?.user?.ageConfirmed) return;
    const t = setTimeout(() => api<{ sessions: Item[] }>(`/api/history?q=${encodeURIComponent(q)}`).then((r) => setItems(r.sessions)), 200);
    return () => clearTimeout(t);
  }, [q, me?.user?.ageConfirmed]);

  if (!me) return <main className="wrap page muted">Loading…</main>;
  if (!me.user?.ageConfirmed) return <main className="wrap"><AgeGate onDone={reload} /></main>;

  const removeEpisode = async (id: string) => {
    if (!confirm("Delete this episode? It will also be removed from any pattern it supported.")) return;
    await api(`/api/episodes/${id}`, { method: "DELETE" });
    setItems((xs) => xs?.map((s) => ({ ...s, episodes: s.episodes.filter((e) => e.id !== id) })) ?? null);
  };

  return (
    <main className="wrap page">
      <h1>History</h1>
      <label htmlFor="q" className="sr-only">Search by person, feeling or topic</label>
      <input id="q" type="search" placeholder="Search by person, feeling or topic" value={q} onChange={(e) => setQ(e.target.value)} />
      {items && items.length === 0 && <p className="muted">{q ? "Nothing matches that search." : "Finished sessions will show up here as short summaries."}</p>}
      <div style={{ marginTop: 16 }}>
        {items?.map((s) => (
          <article key={s.id} className="entry">
            <p className="tag">{new Date(s.date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
            {s.summary && <p>{s.summary}</p>}
            {s.episodes.map((e) => (
              <div key={e.id}>
                <h3>{e.event}</h3>
                <p>
                  {e.feelings.map((f) => <span key={f} className="feel" style={{ marginRight: 6 }}>{f}</span>)}
                  {e.people.length > 0 && <span className="tag"> with {e.people.join(", ")}</span>}
                </p>
                {e.confirmed.length > 0 && <p>What you landed on: {e.confirmed.join("; ")}.</p>}
                {e.plan && <p className="evidence">Plan: {e.plan} {e.outcome && OUTCOME[e.outcome]}</p>}
                <button className="link-btn small" onClick={() => removeEpisode(e.id)}>Delete this episode</button>
              </div>
            ))}
          </article>
        ))}
      </div>
    </main>
  );
}
