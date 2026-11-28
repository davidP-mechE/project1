"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { AgeGate } from "@/components/age-gate";

type Progress = {
  tier: string;
  moments: string[];
  snapshotOnly: boolean;
  vocab?: { month: string; distinct: number; precise: number; words: string[] }[];
  insights?: { month: string; confirmed: number }[];
  followThrough?: { offered: number; reported: number; tried: number; helped: number; recent: { date: string; plan: string; outcome: string | null }[] };
  profile?: { triggers: { text: string; count: number }[]; confusedFeelings: { pair: [string, string]; count: number }[]; traps: { trap: string; count: number }[]; whatHelps: { strategy: string; count: number }[] };
};

const TRAP_NAMES: Record<string, string> = { mind_reading: "Mind-reading other people's intentions", catastrophising: "Jumping to the worst case", all_or_nothing: "All-or-nothing thinking", should_statements: "Shoulds", labelling: "Labelling yourself", personalising: "Taking the blame by default", overgeneralising: "Treating one time as every time", emotional_reasoning: "Feeling it, so it must be true", discounting_positives: "Discounting what went well" };

export default function ProgressPage() {
  const { me, reload } = useMe();
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    if (me?.user?.ageConfirmed) api<Progress>("/api/progress").then(setP);
  }, [me?.user?.ageConfirmed]);

  if (!me) return <main className="wrap page muted">Loading…</main>;
  if (!me.user?.ageConfirmed) return <main className="wrap"><AgeGate onDone={reload} /></main>;

  return (
    <main className="wrap page">
      <h1>Progress</h1>
      <p className="lede">What&apos;s actually changing, in plain words. No streaks, no scores to chase.</p>
      {p && p.moments.length === 0 && <p className="note plain">Progress shows up after a few finished sessions.</p>}
      {p?.moments.map((m) => <p key={m} className="note">{m}</p>)}
      {p?.snapshotOnly && <p className="muted small">Free accounts get a monthly snapshot. Plus shows the full view: feeling words over time, plans and how they went, and what helps.</p>}
      {p && !p.snapshotOnly && (
        <>
          {p.vocab && p.vocab.length > 0 && (
            <>
              <h2>Naming feelings</h2>
              <p className="muted small">Distinct, precise feeling words you used each month.</p>
              <Bars data={p.vocab.map((v) => ({ label: v.month.slice(5), value: v.precise }))} />
            </>
          )}
          {p.insights && p.insights.length > 0 && (
            <>
              <h2>Confirmed insights</h2>
              <Bars data={p.insights.map((v) => ({ label: v.month.slice(5), value: v.confirmed }))} />
            </>
          )}
          {p.followThrough && p.followThrough.offered > 0 && (
            <>
              <h2>Plans</h2>
              <p>{p.followThrough.tried} tried out of {p.followThrough.reported} reported back on; {p.followThrough.helped} helped.</p>
            </>
          )}
          {p.profile && (
            <>
              <h2>Working profile</h2>
              <p className="muted small">Built only from what you confirmed. Every line is a working idea, not a label.</p>
              {p.profile.triggers.length > 0 && <p>Situations that come up most: {p.profile.triggers.map((t) => `${t.text} (${t.count})`).join(", ")}.</p>}
              {p.profile.confusedFeelings.length > 0 && <p>Feelings that tend to show up together: {p.profile.confusedFeelings.map((c) => `${c.pair[0]} and ${c.pair[1]}`).join("; ")}.</p>}
              {p.profile.traps.length > 0 && <p>Thinking traps to watch: {p.profile.traps.map((t) => TRAP_NAMES[t.trap] ?? t.trap).join("; ")}.</p>}
              {p.profile.whatHelps.length > 0 && <p>What helps: {p.profile.whatHelps.map((t) => t.strategy).join(" ")}</p>}
            </>
          )}
        </>
      )}
    </main>
  );
}

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure style={{ margin: 0 }}>
      <div className="spark" role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")}>
        {data.map((d) => <div key={d.label} style={{ height: `${(d.value / max) * 100}%` }} title={`${d.value}`} />)}
      </div>
      <div className="spark-labels" aria-hidden="true">{data.map((d) => <span key={d.label}>{d.label}</span>)}</div>
    </figure>
  );
}
