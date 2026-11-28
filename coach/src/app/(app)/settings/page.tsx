"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { AgeGate } from "@/components/age-gate";
import { CrisisResources } from "@/components/crisis-resources";

export default function SettingsPage() {
  const { me, reload } = useMe();
  const [saved, setSaved] = useState<string | null>(null);
  if (!me) return <main className="wrap page muted">Loading…</main>;
  if (!me.user?.ageConfirmed) return <main className="wrap"><AgeGate onDone={reload} /></main>;
  const u = me.user;

  const patch = async (body: Record<string, unknown>, msg: string) => {
    await api("/api/me", { method: "PATCH", body });
    setSaved(msg);
    reload();
  };

  return (
    <main className="wrap page">
      <h1>Privacy &amp; settings</h1>
      <CrisisResources resources={me.resources} />
      {saved && <p className="note" role="status">{saved}</p>}

      <h2>Memory</h2>
      <label className="toggle">
        <input type="checkbox" checked={u.memoryEnabled} onChange={(e) => patch({ memoryEnabled: e.target.checked }, e.target.checked ? "Memory is on." : "Memory is off. New sessions won't draw on past ones, and no new episodes are saved.")} />
        <span>
          Remember what I confirm
          <br />
          <span className="muted small">Lets the coach connect things across sessions. Only insights you confirm go into memory. You can switch this off any time.</span>
        </span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={u.researchConsent} onChange={(e) => patch({ researchConsent: e.target.checked }, e.target.checked ? "Thanks. De-identified data may be used to improve the app." : "Your conversations won't be used to improve the app.")} />
        <span>
          Help improve the app
          <br />
          <span className="muted small">Off by default. If on, de-identified confirm/reject answers and plan outcomes may be used to improve the coach. Your conversations are never sold, never used for ads, and never used to train models without this.</span>
        </span>
      </label>
      {u.offLimits.length > 0 && (
        <p>
          Topics you asked me not to raise: {u.offLimits.join(", ")}.{" "}
          <button className="link-btn" onClick={() => patch({ offLimits: [] }, "Cleared.")}>Clear</button>
        </p>
      )}

      <h2>Your data</h2>
      <p>Everything you&apos;ve said is encrypted. You can look at it, take it with you, or delete it.</p>
      <div className="row">
        <a className="btn quiet" href="/api/export">Download everything</a>
        <a className="btn quiet" href="/history">View and edit past sessions</a>
      </div>
      <h3>Delete everything</h3>
      <p className="muted small">Removes every session, episode, pattern and setting right away. Backups are cleared within 30 days. This can&apos;t be undone.</p>
      <button
        className="btn danger"
        onClick={async () => {
          if (!confirm("Delete everything? This can't be undone.")) return;
          await api("/api/me", { method: "DELETE" });
          window.location.href = "/";
        }}
      >
        Delete everything
      </button>

      <h2>Plan</h2>
      <p>
        You&apos;re on <strong>{u.tier === "free" ? "Free" : u.tier === "plus" ? "Plus" : "Advanced"}</strong>
        {u.trialEndsAt && new Date(u.trialEndsAt) > new Date() ? ` (trial until ${new Date(u.trialEndsAt).toLocaleDateString()})` : ""}.
        {u.tier === "free" && " Free includes 3 full sessions a week, memory of your last 3 sessions and one pattern preview a month. Safety features and your data are never behind a paywall."}
      </p>
      {process.env.NODE_ENV !== "production" && (
        <p className="small muted">
          Development: switch tier{" "}
          {(["free", "plus", "advanced"] as const).map((t) => (
            <button key={t} className="link-btn" style={{ marginRight: 8 }} onClick={() => api("/api/billing", { body: { action: "dev_set_tier", tier: t } }).then(reload)}>{t}</button>
          ))}
        </p>
      )}
    </main>
  );
}
