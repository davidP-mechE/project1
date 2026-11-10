"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markTourSeenAction } from "@/server/actions/support";

const TOURS = {
  student: {
    title: "Welcome! Here's how your tutoring works",
    steps: [
      ["Classes", "Your tutors' assignments are under Classes, with due dates. Lessons, question sets, College Board practice links and diagnostics all start from there."],
      ["SAT scores", "Add your baseline score first. Every practice test and diagnostic adds to your progress chart, and you'll see an estimate of where you are now."],
      ["Mistake log", "Every question you miss comes back on a schedule until you get it right twice in a row. A few minutes a day here adds up."],
      ["Your goal and test date", "Set them on the SAT scores page, and you get a week-by-week plan back from test day."],
      ["Something wrong?", "Use \"Report a problem\" at the bottom of any page. It tells the site admin which page you were on."],
    ],
  },
  staff: {
    title: "Welcome to the teaching side",
    steps: [
      ["Your classes", "Teaching → My classes lists every class you're on and your role. Specialists see only their subjects and groups; that's enforced by the server, not just hidden."],
      ["Assigning work", "Each class's Assign tab: lessons from your courses, worksheet questions, College Board questions by link, and diagnostics, for the whole class, groups or chosen students."],
      ["Keeping track", "Scores, Alerts and Attendance tabs show who's on track for their goal and who needs a nudge. The program dashboard rolls everything up."],
      ["Review queue", "Nothing Claude writes reaches students until someone approves it: drafted questions, drafted lessons, and AI grades on written answers."],
      ["Security", "Two-factor login is required for staff. Every role change, grade override and export is in the audit log."],
    ],
  },
} as const;

/** A short first-login tour; dismissed for good once finished or skipped. */
export function Walkthrough({ tour }: { tour: keyof typeof TOURS }) {
  const t = TOURS[tour];
  const [step, setStep] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  if (hidden) return null;
  const done = () => {
    setHidden(true);
    start(async () => {
      await markTourSeenAction(tour);
    });
  };
  const [heading, text] = t.steps[step];
  return (
    <section aria-labelledby="tour-title" className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="tour-title" className="text-lg font-semibold">
          {t.title}
        </h2>
        <Button size="sm" variant="ghost" onClick={done}>
          Skip
        </Button>
      </div>
      <p className="mt-3 font-medium">
        {step + 1}. {heading}
      </p>
      <p className="mt-1 text-sm">{text}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted" aria-live="polite">
          {step + 1} of {t.steps.length}
        </span>
        <span className="flex gap-2">
          {step > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < t.steps.length - 1 ? (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={done}>
              Got it
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}
