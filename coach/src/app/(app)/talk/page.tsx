"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/components/use-me";
import { AgeGate } from "@/components/age-gate";
import { CrisisResources } from "@/components/crisis-resources";
import { useSpeech } from "@/components/use-speech";

type Msg = { id: number | string; role: "user" | "assistant"; text: string; feedback?: number | null };
type Notice = { kind: "full" | "preview" | "upsell"; text: string } | null;

export default function TalkPage() {
  const { me, reload } = useMe();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [limit, setLimit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [askGetsMe, setAskGetsMe] = useState(false);
  const [usedVoice, setUsedVoice] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const speech = useSpeech((text) => {
    setDraft((d) => (d ? `${d} ${text}` : text));
    setUsedVoice(true);
  });

  const start = useCallback(async () => {
    setError(null);
    setLimit(null);
    try {
      const r = await api<{ session: { id: string; crisis: boolean }; messages: Msg[] }>("/api/session", { method: "POST" });
      setSessionId(r.session.id);
      setMessages(r.messages);
      setCrisis(r.session.crisis);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setLimit(e.message);
      else setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (me?.user?.ageConfirmed) start();
  }, [me?.user?.ageConfirmed, start]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, notice]);

  async function send() {
    const text = draft.trim();
    if (!text || !sessionId || busy) return;
    speech.stop();
    setBusy(true);
    setError(null);
    setNotice(null);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text }]);
    setDraft("");
    try {
      const r = await api<{ reply: string; messageId: number; crisis: boolean; episodeId: string | null; patternNotice: Notice }>("/api/turn", { body: { sessionId, text, voice: usedVoice } });
      setMessages((m) => [...m, { id: r.messageId, role: "assistant", text: r.reply }]);
      if (r.crisis) setCrisis(true);
      if (r.patternNotice) setNotice(r.patternNotice);
      if (r.episodeId) setAskGetsMe(true);
      setUsedVoice(false);
    } catch (e) {
      setError((e as Error).message);
      setDraft(text);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function endSession() {
    if (!sessionId) return;
    await api("/api/session/end", { body: { sessionId } }).catch(() => {});
    setSessionId(null);
    setMessages([]);
    setNotice(null);
    setAskGetsMe(false);
    start();
  }

  async function rate(id: number | string, value: 1 | -1) {
    if (typeof id !== "number") return;
    const current = messages.find((m) => m.id === id)?.feedback ?? null;
    const next = current === value ? null : value;
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, feedback: next } : m)));
    await api("/api/feedback", { body: { messageId: id, value: next } }).catch(() => {});
  }

  if (!me) return <main className="wrap page muted">Loading…</main>;
  if (!me.user?.ageConfirmed) return <main className="wrap"><AgeGate onDone={reload} /></main>;

  return (
    <main className="wrap">
      {me.offlineEngine && (
        <p className="note plain small muted" style={{ marginTop: 16 }}>
          Running on the offline development engine (no language model key set). Replies are rule-based and much simpler than the real coach.
        </p>
      )}
      {limit && (
        <div className="page">
          <h1>That&apos;s this week&apos;s free sessions</h1>
          <p className="lede">{limit}</p>
          <div className="row">
            <TrialButton onStarted={() => { reload(); start(); }} />
            <Link href="/history" className="btn quiet">Look back at past sessions</Link>
          </div>
        </div>
      )}
      {error && <p className="note help" role="alert" style={{ marginTop: 16 }}>{error}</p>}

      <section className="convo" aria-live="polite" aria-label="Conversation">
        {messages.map((m) =>
          m.role === "assistant" ? (
            <div key={m.id} className="coach">
              <p>{m.text}</p>
              {typeof m.id === "number" && (
                <div className="msg-tools" aria-label="Was this reply useful?">
                  <button aria-pressed={m.feedback === 1} onClick={() => rate(m.id, 1)} aria-label="Helpful">Helpful</button>
                  <button aria-pressed={m.feedback === -1} onClick={() => rate(m.id, -1)} aria-label="Not helpful">Not it</button>
                </div>
              )}
            </div>
          ) : (
            <div key={m.id} className="you"><span>{m.text}</span></div>
          ),
        )}
        {busy && <p className="thinking">Thinking it through…</p>}
        {crisis && <CrisisResources resources={me.resources} focus />}
        {notice && (
          <div className="note">
            <p style={{ margin: 0 }}>{notice.text}</p>
            <p className="small" style={{ margin: "6px 0 0" }}>
              {notice.kind === "upsell" ? <TrialButton small onStarted={reload} /> : <Link href="/patterns">See the episodes behind it</Link>}
            </p>
          </div>
        )}
        {askGetsMe && <GetsMe onDone={() => setAskGetsMe(false)} />}
        <div ref={endRef} />
      </section>

      {sessionId && (
        <div className="composer">
          <div className="composer-inner">
            <div className="composer-box">
              {speech.supported && (
                <button
                  type="button"
                  className="mic"
                  aria-pressed={speech.listening}
                  aria-label={speech.listening ? "Stop listening" : "Talk (tap, or hold)"}
                  onPointerDown={speech.pointerDown}
                  onPointerUp={speech.pointerUp}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), speech.toggle())}
                >
                  <MicIcon />
                </button>
              )}
              <label htmlFor="say" className="sr-only">Your message</label>
              <textarea
                id="say"
                ref={inputRef}
                rows={1}
                value={speech.listening && speech.interim ? `${draft} ${speech.interim}`.trim() : draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={speech.listening ? "Listening…" : "Tell me what happened"}
              />
              <button className="btn" onClick={send} disabled={busy || !draft.trim()}>Send</button>
            </div>
            <p className="composer-note">
              {usedVoice ? "Check the words before you send: a misheard word can change what I read." : "Enter to send, Shift+Enter for a new line."}{" "}
              <button className="link-btn" onClick={endSession}>End session</button>
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function TrialButton({ onStarted, small }: { onStarted: () => void; small?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        className={small ? "link-btn" : "btn"}
        onClick={async () => {
          try {
            await api("/api/billing", { body: { action: "start_trial" } });
            onStarted();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      >
        Try Plus free for 7 days
      </button>
      {msg && <span className="small muted"> {msg}</span>}
    </>
  );
}

function GetsMe({ onDone }: { onDone: () => void }) {
  const send = (score: number) => api("/api/checkin", { body: { kind: "gets_me", score } }).finally(onDone);
  return (
    <div className="note plain">
      <p style={{ margin: 0 }}>Did this feel like talking to someone who gets you?</p>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn quiet" onClick={() => send(2)}>Yes</button>
        <button className="btn quiet" onClick={() => send(1)}>Somewhat</button>
        <button className="btn quiet" onClick={() => send(0)}>No</button>
        <button className="link-btn" onClick={onDone}>Skip</button>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
