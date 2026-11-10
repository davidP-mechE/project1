"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { joinClassAction, leaveClassAction } from "@/server/actions/classes";

/** "Join" on an invite link page. */
export function JoinButton({ code, name }: { code: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await joinClassAction(code);
            if (!res.ok) return setError(res.error);
            router.push("/classes");
          })
        }
      >
        Join {name}
      </Button>
    </div>
  );
}

/** Enter a class code (on the Classes page). */
export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await joinClassAction(code);
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: "You're in! The class's assignments are below." });
          setCode("");
          router.refresh();
        });
      }}
    >
      <Field label="Class code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. K7Q2MXA" maxLength={20} autoComplete="off" className="sm:w-56" required />
      <Button type="submit" disabled={pending || code.trim().length < 4}>
        Join class
      </Button>
      {msg && (
        <Alert tone={msg.tone} className="sm:ml-2">
          {msg.text}
        </Alert>
      )}
    </form>
  );
}

export function LeaveClassButton({ classId, name }: { classId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Leave ${name}? You keep your copies of its courses, but your teacher won't see your work any more.`)) return;
        start(async () => {
          await leaveClassAction(classId);
          router.refresh();
        });
      }}
    >
      Leave class
    </Button>
  );
}
