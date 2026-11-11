"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { createTestAction, startAttemptAction } from "@/server/actions/tracker";

type Test = { id: string; name: string; shared: boolean };
const STANDARD = [
  { section: "rw", number: 1, question_count: 27 },
  { section: "rw", number: 2, question_count: 27 },
  { section: "math", number: 1, question_count: 22 },
  { section: "math", number: 2, question_count: 22 },
];

/** Pick a test from the catalog (or add a custom one) and the date, then start logging. */
export function NewLog({ tests, today, presetTestId }: { tests: Test[]; today: string; presetTestId?: string | null }) {
  const router = useRouter();
  const [testId, setTestId] = useState(presetTestId && tests.some((t) => t.id === presetTestId) ? presetTestId : (tests[0]?.id ?? ""));
  const [date, setDate] = useState(today);
  const [custom, setCustom] = useState(tests.length === 0);
  const [name, setName] = useState("");
  const [source, setSource] = useState("bluebook");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          let id = testId;
          if (custom) {
            const t = await createTestAction({ name, source, modules: STANDARD });
            if (!t.ok) return setError(t.error);
            id = t.testId;
          }
          const r = await startAttemptAction(id, date);
          if (!r.ok) return setError(r.error);
          router.push(`/practice-tests/${r.attemptId}`);
        });
      }}
    >
      {!custom ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Test
          <select className={inputClasses} value={testId} onChange={(e) => setTestId(e.target.value)}>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.shared ? "" : " (yours)"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Test name
            <input className={inputClasses} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Bluebook Practice Test 7" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Where you took it
            <select className={inputClasses} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="bluebook">Bluebook</option>
              <option value="paper">Paper</option>
              <option value="other">Other</option>
            </select>
          </label>
          <p className="text-xs text-muted sm:col-span-2">Uses the standard layout: two R&amp;W modules of 27 and two Math modules of 22.</p>
        </div>
      )}
      <button type="button" className="self-start text-sm underline" onClick={() => setCustom(!custom)}>
        {custom ? "Pick from the list instead" : "My test isn't listed: add it"}
      </button>
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
        Date taken
        <input type="date" className={inputClasses} value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending || (!custom && !testId)}>Start logging</Button>
      </div>
    </form>
  );
}
