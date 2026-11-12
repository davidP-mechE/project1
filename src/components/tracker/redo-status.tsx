"use client";

import { useState, useTransition } from "react";
import { setRedoStatusAction } from "@/server/actions/tracker";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { id: "to_redo", label: "To redo" },
  { id: "redone_correct", label: "Redone (correct)" },
  { id: "still_wrong", label: "Still wrong" },
] as const;
type Status = (typeof OPTIONS)[number]["id"];

export function RedoStatus({ itemId, status, label }: { itemId: string; status: Status; label: string }) {
  const [value, setValue] = useState<Status>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={`Redo status for ${label}`} className="flex flex-wrap gap-1">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={pending}
            onClick={() => {
              const before = value;
              setValue(o.id);
              start(async () => {
                const r = await setRedoStatusAction(itemId, o.id);
                if (!r.ok) {
                  setValue(before);
                  setError(r.error);
                }
              });
            }}
            className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", value === o.id ? (o.id === "redone_correct" ? "border-success bg-success-bg text-success" : o.id === "still_wrong" ? "border-danger bg-danger-bg text-danger" : "border-focus bg-text text-bg") : "border-border bg-surface")}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
