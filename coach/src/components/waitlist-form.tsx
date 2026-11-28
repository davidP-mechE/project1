"use client";
import { useState } from "react";
import { api } from "@/lib/api";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") return <p className="note" role="status">You&apos;re on the list. We&apos;ll email {email} when it opens.</p>;
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setError(null);
        try {
          await api("/api/waitlist", { body: { email, source: "landing" } });
          setState("done");
        } catch (err) {
          setError((err as Error).message);
          setState("idle");
        }
      }}
    >
      <label htmlFor="email" className="sr-only">Email</label>
      <input id="email" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
      <button className="btn" disabled={state === "busy"}>Join the waitlist</button>
      {error && <p className="small" style={{ color: "var(--help)", width: "100%" }} role="alert">{error}</p>}
    </form>
  );
}
