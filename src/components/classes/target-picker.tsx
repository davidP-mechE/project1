"use client";

import { useState } from "react";

export type TargetValue = { groupIds: string[]; studentIds: string[] };
export type TargetOptions = { groups: { id: string; name: string }[]; students: { id: string; name: string }[] };

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Who an assignment is for: the whole class, some groups, or chosen students. */
export function TargetPicker({ options, value, onChange }: { options: TargetOptions; value: TargetValue; onChange: (v: TargetValue) => void }) {
  const [mode, setMode] = useState<"class" | "groups" | "students">(value.groupIds.length ? "groups" : value.studentIds.length ? "students" : "class");
  const set = (m: typeof mode) => {
    setMode(m);
    onChange({ groupIds: [], studentIds: [] });
  };
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium">Who it&apos;s for</legend>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "class"} onChange={() => set("class")} className="size-4 accent-[var(--primary)]" />
          Whole class
        </label>
        {options.groups.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "groups"} onChange={() => set("groups")} className="size-4 accent-[var(--primary)]" />
            Groups
          </label>
        )}
        {options.students.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "students"} onChange={() => set("students")} className="size-4 accent-[var(--primary)]" />
            Chosen students
          </label>
        )}
      </div>
      {mode === "groups" && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border p-2">
          {options.groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2">
              <input type="checkbox" checked={value.groupIds.includes(g.id)} onChange={() => onChange({ ...value, groupIds: toggle(value.groupIds, g.id) })} className="size-4 accent-[var(--primary)]" />
              {g.name}
            </label>
          ))}
        </div>
      )}
      {mode === "students" && (
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
          {options.students.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input type="checkbox" checked={value.studentIds.includes(s.id)} onChange={() => onChange({ ...value, studentIds: toggle(value.studentIds, s.id) })} className="size-4 accent-[var(--primary)]" />
              {s.name || "Student"}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
