"use client";
import { useState } from "react";
import { api } from "@/lib/api";

const COUNTRIES = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
] as const;

export function AgeGate({ onDone }: { onDone: () => void }) {
  const [adult, setAdult] = useState(false);
  const [country, setCountry] = useState("US");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <h1>Before we start</h1>
      <p className="lede">This is an AI coach for understanding your own reactions. It isn&apos;t therapy, it can&apos;t diagnose anything, and it isn&apos;t a crisis service, though it will point you to people who are if you need them.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/account", { body: { adult: true, country } });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="toggle">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>I&apos;m 18 or older.</span>
        </label>
        <label className="toggle" style={{ flexDirection: "column", gap: 6 }}>
          <span>Where are you? We use this to show the right crisis lines.</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        {error && <p className="note help" role="alert">{error}</p>}
        <button className="btn" disabled={!adult || busy}>Continue</button>
      </form>
    </div>
  );
}
