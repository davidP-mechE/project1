"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  acceptStaffInviteAction,
  addStaffAction,
  cancelStaffInviteAction,
  createGroupAction,
  deleteGroupAction,
  removeStaffAction,
  resendStaffInviteAction,
  resetStaffTwoFactorAction,
  reviewGradeAction,
  transferAdminAction,
  updateGroupAction,
  updateProgramAction,
  startSemesterAction,
  updateStaffAction,
} from "@/server/actions/staff";
import { DOMAINS, SECTIONS } from "@/lib/sat/domains";

type Role = "TEACHER" | "SPECIALIST" | "VIEWER";
export type ScopeValue = { role: Role; sections: string[]; domains: string[]; groupIds: string[]; canManageStaff: boolean };

const ROLE_HELP: Record<Role, string> = {
  TEACHER: "Full access to this class and all its groups.",
  SPECIALIST: "Teaches and grades only the subjects and/or groups you choose.",
  VIEWER: "Read-only reports, for observers like a counselor.",
};
const select = "h-10 rounded-lg border border-border bg-surface px-3 text-sm";
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Role, plus (for specialists) the subjects and groups they cover. */
export function ScopePicker({ value, onChange, groups, isAdmin, idPrefix }: { value: ScopeValue; onChange: (v: ScopeValue) => void; groups: { id: string; name: string }[]; isAdmin: boolean; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Role</span>
        <select className={select} value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as Role, canManageStaff: false })}>
          <option value="TEACHER">Teacher</option>
          <option value="SPECIALIST">Specialist</option>
          <option value="VIEWER">Viewer</option>
        </select>
        <span className="text-xs text-muted">{ROLE_HELP[value.role]}</span>
      </label>
      {value.role === "TEACHER" && isAdmin && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.canManageStaff} onChange={(e) => onChange({ ...value, canManageStaff: e.target.checked })} className="size-4 accent-[var(--primary)]" />
          Can add, change and remove staff
        </label>
      )}
      {value.role === "SPECIALIST" && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Subjects they cover (choose a whole section, or single domains)</legend>
            {SECTIONS.map((s) => (
              <div key={s.id} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={value.sections.includes(s.id)} onChange={() => onChange({ ...value, sections: toggle(value.sections, s.id), domains: value.domains.filter((d) => DOMAINS.find((x) => x.id === d)?.section !== s.id) })} className="size-4 accent-[var(--primary)]" />
                  All of {s.name}
                </label>
                {!value.sections.includes(s.id) && (
                  <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                    {DOMAINS.filter((d) => d.section === s.id).map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={value.domains.includes(d.id)} onChange={() => onChange({ ...value, domains: toggle(value.domains, d.id) })} className="size-4 accent-[var(--primary)]" />
                        {d.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Students they cover</legend>
            {groups.length === 0 ? (
              <p className="text-xs text-muted">All students. To limit them to some students (e.g. a student tutor), make a group first on the Groups tab.</p>
            ) : (
              <>
                <p className="text-xs text-muted">None ticked = all students.</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-g-${g.id}`}>
                      <input id={`${idPrefix}-g-${g.id}`} type="checkbox" checked={value.groupIds.includes(g.id)} onChange={() => onChange({ ...value, groupIds: toggle(value.groupIds, g.id) })} className="size-4 accent-[var(--primary)]" />
                      {g.name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}

const EMPTY: ScopeValue = { role: "TEACHER", sections: [], domains: [], groupIds: [], canManageStaff: false };

export function AddStaffForm({ classId, groups, isAdmin }: { classId: string; groups: { id: string; name: string }[]; isAdmin: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<ScopeValue>({ ...EMPTY, role: "SPECIALIST" });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addStaffAction(classId, email, scope);
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: "added" in res.result ? `Added ${email}. They've been emailed.` : `Invited ${email}. They'll get a link to sign up and join.` });
          setEmail("");
          router.refresh();
        });
      }}
    >
      <Field label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
      <ScopePicker value={scope} onChange={setScope} groups={groups} isAdmin={isAdmin} idPrefix="add" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          Add to staff
        </Button>
      </div>
    </form>
  );
}

export function StaffRowActions({ classId, person, groups, isAdmin, isSelf }: { classId: string; person: { userId: string; name: string } & ScopeValue; groups: { id: string; name: string }[]; isAdmin: boolean; isSelf: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ScopeValue>(person);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = (res: { ok: boolean; error?: string }) => {
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setError(null);
    setOpen(false);
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          Change role
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(isSelf ? "Remove yourself from this class's staff?" : `Remove ${person.name} from this class's staff? They lose access right away.`)) return;
            start(async () => done(await removeStaffAction(classId, person.userId)));
          }}
        >
          Remove
        </Button>
        {isAdmin && !isSelf && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Reset ${person.name}'s two-factor login? They'll be logged out and must set it up again. Only do this if you've confirmed it's really them.`)) return;
              start(async () => done(await resetStaffTwoFactorAction(classId, person.userId)));
            }}
          >
            Reset two-factor
          </Button>
        )}
      </div>
      {open && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => done(await updateStaffAction(classId, person.userId, scope)));
          }}
        >
          <ScopePicker value={scope} onChange={setScope} groups={groups} isAdmin={isAdmin} idPrefix={person.userId} />
          <div>
            <Button size="sm" type="submit" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function InviteActions({ classId, inviteId }: { classId: string; inviteId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await resendStaffInviteAction(classId, inviteId); setMsg(r.ok ? "Sent again." : r.error); router.refresh(); })}>
        Resend
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await cancelStaffInviteAction(classId, inviteId); if (!r.ok) setMsg(r.error); router.refresh(); })}>
        Cancel
      </Button>
      {msg && <span className="text-xs text-muted" role="status">{msg}</span>}
    </span>
  );
}

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button disabled={pending} onClick={() => start(async () => { const r = await acceptStaffInviteAction(token); if (!r.ok) return setError(r.error); router.push(`/teach/${r.classId}`); })}>
          Accept and open the class
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

// ── Groups ──

export function GroupEditor({ classId, group, students }: { classId: string; group?: { id: string; name: string; members: { id: string }[] }; students: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState<string[]>(group?.members.map((m) => m.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = group ? await updateGroupAction(classId, group.id, { name, studentIds: picked }) : await createGroupAction(classId, name, picked);
          if (!res.ok) return setError(res.error);
          setError(null);
          if (!group) {
            setName("");
            setPicked([]);
          }
          router.refresh();
        });
      }}
    >
      <Field label="Group name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Math 1000–1100, Tuesday session, Ana's students" />
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Students ({picked.length})</legend>
        {students.length === 0 ? (
          <p className="text-xs text-muted">No students have joined yet.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {students.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked(toggle(picked, s.id))} className="size-4 accent-[var(--primary)]" />
                {s.name || "Student"}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {group ? "Save group" : "Create group"}
        </Button>
        {group && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete the group "${group.name}"? Specialists limited to it will see no students until they're given another group.`)) return;
              start(async () => {
                const res = await deleteGroupAction(classId, group.id);
                if (!res.ok) setError(res.error);
                router.refresh();
              });
            }}
          >
            Delete group
          </Button>
        )}
      </div>
    </form>
  );
}

// ── AI grade review ──

export function ReviewGradeForm({ classId, answerId, score }: { classId: string; answerId: string; score: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(Math.round(score * 100)));
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = (res: { ok: boolean; error?: string }) => (res.ok ? router.refresh() : setError(res.error ?? "Something went wrong."));
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 100) return setError("Enter a score from 0 to 100.");
        start(async () => done(await reviewGradeAction(classId, answerId, { score: n / 100, feedback })));
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => done(await reviewGradeAction(classId, answerId, {})))}>
          Confirm grade
        </Button>
        <span className="text-xs text-muted">or override:</span>
        <label className="flex items-center gap-1 text-sm">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" aria-label="Score out of 100" className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-right" />%
        </label>
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Feedback for the student (optional)" placeholder="Feedback (optional)" maxLength={2000} className="h-8 min-w-48 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" />
        <Button size="sm" type="submit" disabled={pending}>
          Save override
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

// ── Program ──

export function ProgramSettingsForm({ program }: { program: { id: string; name: string; targets: number[]; inviteDays: number; aiDailyCapCents: number | null; testDates: Date[] } }) {
  const router = useRouter();
  const [name, setName] = useState(program.name);
  const [targets, setTargets] = useState(program.targets.join(", "));
  const [days, setDays] = useState(String(program.inviteDays));
  const [dates, setDates] = useState(program.testDates.map((d) => d.toISOString().slice(0, 10)).join("\n"));
  const [cap, setCap] = useState(program.aiDailyCapCents === null ? "" : (program.aiDailyCapCents / 100).toFixed(2));
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateProgramAction(program.id, {
            name,
            targets: targets.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite),
            inviteDays: Number(days),
            aiDailyCapCents: cap.trim() === "" ? null : Math.round(Number(cap) * 100),
            testDates: dates.split(/[\s,]+/).filter(Boolean),
          });
          setMsg(res.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: res.error });
          router.refresh();
        });
      }}
    >
      <Field label="Program name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <Field label="Score targets" hint="e.g. 1200, 1300" value={targets} onChange={(e) => setTargets(e.target.value)} />
      <Field label="Staff invites last (days)" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
      <Field label="Daily AI spending cap ($)" hint="Blank = no program cap (each person's own allowance still applies)." inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
      <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium">Official SAT dates (one per line, like 2027-03-13)</span>
        <textarea value={dates} onChange={(e) => setDates(e.target.value)} rows={3} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm" />
        <span className="text-xs text-muted">Students pick their test date from these (or enter their own); their plan counts back from it.</span>
      </label>
      <div className="sm:col-span-2 flex flex-col gap-2">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <Button type="submit" disabled={pending}>
            Save settings
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The program's own public page (/p/<slug>): address, badge, copy and whether it's live. */
export function ProgramPublicPageForm({ program }: { program: { id: string; slug: string | null; badge: string | null; isPublic: boolean; publicBlurb: string | null; schoolAverage: number | null; goalGain: number | null } }) {
  const router = useRouter();
  const [slug, setSlug] = useState(program.slug ?? "");
  const [badge, setBadge] = useState(program.badge ?? "");
  const [blurb, setBlurb] = useState(program.publicBlurb ?? "");
  const [avg, setAvg] = useState(program.schoolAverage?.toString() ?? "");
  const [gain, setGain] = useState(program.goalGain?.toString() ?? "");
  const [isPublic, setIsPublic] = useState(program.isPublic);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateProgramAction(program.id, { slug: slug || null, badge: badge || null, publicBlurb: blurb || null, schoolAverage: num(avg), goalGain: num(gain), isPublic });
          setMsg(res.ok ? { tone: "success", text: isPublic && slug ? `Saved. The page is live at /p/${slug.toLowerCase()}.` : "Saved." } : { tone: "error", text: res.error });
          router.refresh();
        });
      }}
    >
      <Field label="Page address" hint="Lowercase letters, numbers, dashes: e.g. 1600 gives /p/1600." value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={40} />
      <Field label="Badge text" hint="Up to 4 letters or numbers, shown in the program's seal. Blank: from the name." value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={4} />
      <Field label="Starting average" hint="e.g. your school's average SAT score." inputMode="numeric" value={avg} onChange={(e) => setAvg(e.target.value)} />
      <Field label="Goal gain (points)" hint="e.g. 300" inputMode="numeric" value={gain} onChange={(e) => setGain(e.target.value)} />
      <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium">About the program</span>
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3} maxLength={1000} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        <span className="text-xs text-muted">A short paragraph for the public page. No student names.</span>
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        Public page is live
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <Button type="submit" disabled={pending}>
            Save public page
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Start a new semester: carry chosen classes forward (fresh copies) and archive the old ones. */
export function NewSemesterForm({ programId, classes }: { programId: string; classes: { id: string; name: string; students: number }[] }) {
  const router = useRouter();
  const [semester, setSemester] = useState("");
  const [chosen, setChosen] = useState<string[]>(classes.map((c) => c.id));
  const [reinvite, setReinvite] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!classes.length) return <p className="text-sm text-muted">No active classes to carry forward.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(`Start ${semester || "the new semester"}? ${chosen.length} class${chosen.length === 1 ? "" : "es"} will be copied, and last semester's will be archived (read-only). Student records stay.`)) return;
        start(async () => {
          const res = await startSemesterAction(programId, { semester, classIds: chosen, reinvite });
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: `Started. New classes: ${res.created.map((c) => `${c.name} (code ${c.joinCode}${c.invited ? `, ${c.invited} invited` : ""})`).join("; ")}.` });
          router.refresh();
        });
      }}
    >
      <Field label="Semester name" hint="e.g. Spring 2027. It's added to each new class's name." value={semester} onChange={(e) => setSemester(e.target.value)} required maxLength={40} />
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Classes to carry forward</legend>
        {classes.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))} className="size-4 accent-[var(--primary)]" />
            {c.name} <span className="text-muted">({c.students} student{c.students === 1 ? "" : "s"})</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={reinvite} onChange={(e) => setReinvite(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        Email last semester&apos;s students an invite to the new classes
      </label>
      <p className="text-xs text-muted">Each new class keeps its teacher, staff, roles, scopes and groups (empty), with a new join code. Scores, answers, attendance and mistake logs stay with the students. Courses are added again from the new class&apos;s Assign tab.</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !chosen.length}>
          {pending ? "Starting…" : "Start the new semester"}
        </Button>
      </div>
    </form>
  );
}

export function TransferAdminForm({ programId, programName, staff }: { programId: string; programName: string; staff: { id: string; name: string; email: string }[] }) {
  const router = useRouter();
  const [to, setTo] = useState(staff[0]?.id ?? "");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (staff.length === 0) return <p className="text-sm text-muted">Add the person to a class&apos;s staff first; then you can make them the program admin.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await transferAdminAction(programId, to, confirm);
          if (!res.ok) return setError(res.error);
          router.push("/teach");
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">New admin</span>
        <select className={select} value={to} onChange={(e) => setTo(e.target.value)}>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name || s.email} ({s.email})
            </option>
          ))}
        </select>
      </label>
      <Field label={`Type "${programName}" to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="danger" disabled={pending || confirm.trim() !== programName}>
          Make them the admin
        </Button>
      </div>
    </form>
  );
}
