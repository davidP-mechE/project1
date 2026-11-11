"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { saveQuestionDesmosAction } from "@/server/actions/bank";
import { DesmosGraph, type DesmosHandle } from "./desmos-graph";

/** The editor's calculator: build the check graph, then "Save graph to this question" (stores calculator.getState()). */
export function QuestionDesmosEditor({ questionId, apiKey, initialState }: { questionId: string; apiKey: string | null; initialState: object | null }) {
  const router = useRouter();
  const g = useRef<DesmosHandle>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (state: object | null) =>
    start(async () => {
      const r = await saveQuestionDesmosAction(questionId, state);
      setMsg(r.ok ? { tone: "success", text: state ? `Graph saved (question version ${r.version}).` : "Graph removed." } : { tone: "error", text: r.error });
      if (r.ok) router.refresh();
    });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Desmos check (optional)</h2>
      <p className="text-sm text-muted">Students see it as &quot;Show the Desmos check&quot; under the explanation. {initialState ? "This question has a saved graph." : "No graph saved yet."}</p>
      <DesmosGraph ref={g} apiKey={apiKey} initialState={initialState} className="h-96" />
      {apiKey && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            onClick={() => {
              const s = g.current?.getState();
              if (!s) return setMsg({ tone: "error", text: "The calculator hasn't loaded yet." });
              save(s);
            }}
          >
            Save graph to this question
          </Button>
          {initialState && (
            <Button variant="secondary" disabled={pending} onClick={() => confirm("Remove the saved graph?") && save(null)}>
              Remove graph
            </Button>
          )}
        </div>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </Card>
  );
}
