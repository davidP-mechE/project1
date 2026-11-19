"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { bookingToSessionAction, bookSlotAction, cancelBookingAction, deleteRuleAction, rescheduleBookingAction, saveRuleAction } from "@/server/actions/office-hours";

import { WEEKDAYS } from "@/lib/office-hours/slots";

type RuleValue = { programId: string; weekday: number; start: string; end: string; slotMinutes: number; bufferMinutes: number; maxPerDay: number; validFrom: string; validUntil: string; location: string };

/** Staff: add or edit a weekly open time. */
export function RuleForm({ programs, initial, ruleId, today, onDone }: { programs: { id: string; name: string }[]; initial?: RuleValue; ruleId?: string; today: string; onDone?: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<RuleValue>(initial ?? { programId: programs[0]?.id ?? "", weekday: 2, start: "15:00", end: "17:00", slotMinutes: 20, bufferMinutes: 10, maxPerDay: 6, validFrom: today, validUntil: "", location: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const base = useId();
  const set = <K extends keyof RuleValue>(k: K, val: RuleValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const field = (k: keyof RuleValue, label: string, input: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${base}-${k}`} className="text-sm font-medium">{label}</label>
      {input}
    </div>
  );
  const num = (k: "slotMinutes" | "bufferMinutes" | "maxPerDay", min: number, max: number) => <input id={`${base}-${k}`} type="number" min={min} max={max} required value={v[k]} onChange={(e) => set(k, Number(e.target.value))} className={inputClasses} />;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveRuleAction({ ...v, validUntil: v.validUntil || null, location: v.location || null }, ruleId);
          setMsg(r.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: r.error });
          if (r.ok) {
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {programs.length > 1 && field("programId", "Program", <select id={`${base}-programId`} value={v.programId} onChange={(e) => set("programId", e.target.value)} className={inputClasses}>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>)}
        {field("weekday", "Day", <select id={`${base}-weekday`} value={v.weekday} onChange={(e) => set("weekday", Number(e.target.value))} className={inputClasses}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>)}
        {field("start", "From", <input id={`${base}-start`} type="time" required value={v.start} onChange={(e) => set("start", e.target.value)} className={inputClasses} />)}
        {field("end", "Until", <input id={`${base}-end`} type="time" required value={v.end} onChange={(e) => set("end", e.target.value)} className={inputClasses} />)}
        {field("slotMinutes", "Slot length (minutes)", num("slotMinutes", 5, 180))}
        {field("bufferMinutes", "Gap between slots (minutes)", num("bufferMinutes", 0, 60))}
        {field("maxPerDay", "Most bookings a day", num("maxPerDay", 1, 30))}
        {field("validFrom", "First day", <input id={`${base}-validFrom`} type="date" required value={v.validFrom} onChange={(e) => set("validFrom", e.target.value)} className={inputClasses} />)}
        {field("validUntil", "Last day (optional)", <input id={`${base}-validUntil`} type="date" value={v.validUntil} onChange={(e) => set("validUntil", e.target.value)} className={inputClasses} />)}
        {field("location", "Where (room or video link)", <input id={`${base}-location`} maxLength={300} value={v.location} onChange={(e) => set("location", e.target.value)} className={inputClasses} />)}
      </div>
      <p className="text-xs text-muted">Times are in your own time zone (Settings). Days the program calendar marks as closed are skipped.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{ruleId ? "Save changes" : "Add open time"}</Button>
        {onDone && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

export function RuleRow({ label, rule, ruleId, programs, today }: { label: string; rule: RuleValue; ruleId: string; programs: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (editing) return <RuleForm programs={programs} initial={rule} ruleId={ruleId} today={today} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex-1 text-sm">{label}</span>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await deleteRuleAction(ruleId); router.refresh(); })}>Remove</Button>
    </div>
  );
}

/** Staff actions on one booking: attended / no-show (makes a 1:1 session with attendance), or cancel. */
export function StaffBookingActions({ bookingId, upcoming, marked }: { bookingId: string; upcoming: boolean; marked: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); setError(r.ok ? null : (r.error ?? "Something went wrong.")); router.refresh(); });
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-1">
        <Button size="sm" variant={marked === "PRESENT" ? "primary" : "secondary"} disabled={pending} aria-pressed={marked === "PRESENT"} onClick={() => act(() => bookingToSessionAction(bookingId, true))}>Attended</Button>
        <Button size="sm" variant={marked === "ABSENT" ? "primary" : "secondary"} disabled={pending} aria-pressed={marked === "ABSENT"} onClick={() => act(() => bookingToSessionAction(bookingId, false))}>No-show</Button>
        {upcoming && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelBookingAction(bookingId))}>Cancel</Button>}
      </span>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Student: book one slot (with an optional note), or move an existing booking to it. */
export function SlotButton({ staffId, programId, start: startIso, label, moveId }: { staffId: string; programId: string; start: string; label: string; moveId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, go] = useTransition();
  const noteId = useId();
  const submit = () =>
    go(async () => {
      const r = moveId ? await rescheduleBookingAction(moveId, startIso) : await bookSlotAction({ staffId, programId, start: startIso, note: note || undefined });
      if (!r.ok) return setError(r.error);
      router.push("/office-hours?booked=1");
      router.refresh();
    });
  if (moveId) {
    return (
      <span className="flex flex-col gap-1">
        <Button size="sm" variant="secondary" disabled={pending} onClick={submit} aria-label={`Move to ${label}`}>{label}</Button>
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant={open ? "primary" : "secondary"} aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Book ${label}`}>{label}</Button>
      {open && (
        <form className="flex flex-col gap-1.5 rounded-md border border-border p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor={noteId} className="text-xs font-medium">What would you like help with? (optional)</label>
          <input id={noteId} autoFocus maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClasses} h-9`} />
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Booking…" : "Book it"}</Button>
          {error && <span role="alert" className="text-xs text-danger">{error}</span>}
        </form>
      )}
    </span>
  );
}

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await cancelBookingAction(bookingId); if (!r.ok) return setError(r.error); router.refresh(); })}>Cancel</Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
