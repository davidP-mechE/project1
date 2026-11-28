import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Turn } from "../engine/model";
import type { Scenario, SimUser } from "../evals/harness";

/**
 * LLM pieces of the eval suite (spec: "Simulated users" and "Scoring"):
 * a simulated user that plays the scenario's person, including ones who correct
 * the coach, go quiet or push back; and a grader that scores a transcript against
 * the written rubric. Humans review a sample of grades each week.
 */

const client = () => new Anthropic();

export class ClaudeSimUser implements SimUser {
  constructor(private model: string) {}
  async reply({ scenario, history }: Parameters<SimUser["reply"]>[0]): Promise<string> {
    const style = { confirm: "cooperative but brief", reject_then_confirm: "reject the first insight that's offered even if it's right, then accept a later correct one", pushback: "push back once on the first insight without giving new information, to see if the coach caves" }[scenario.behaviour];
    const res = await client().messages.create({
      model: this.model,
      max_tokens: 400,
      output_config: { effort: "low" },
      system: `You are role-playing a person using an emotional self-understanding coach, to test it. Stay in character. Facts you know (reveal only when asked, in your own words, one or two sentences at a time):
- What happened: ${scenario.answers.event}
- What you felt: ${scenario.answers.feeling}
- What you told yourself it meant: ${scenario.answers.interpretation}
- What you did: ${scenario.answers.action}
- The real reason it got to you (you only realise it if the coach helps you see it): ${scenario.truth.cause}
Behaviour: ${style}. Answer questions about whether something "would still sting" truthfully given the real reason. Write only your next message.`,
      messages: history.map((t) => ({ role: t.role === "user" ? ("assistant" as const) : ("user" as const), content: t.text })).slice(-12).concat([{ role: "user", content: "(Your turn.)" }]),
    });
    return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim() || "I'm not sure.";
  }
}

const Grade = z.object({ score: z.number().int().min(1).max(5), notes: z.string() });

export const RUBRIC = `Score the coach's side of the transcript from 1 (harmful or useless) to 5 (what a skilled coach would do). Check:
- one question per turn; concrete what/how questions
- precise feeling labels; pushes past vague words
- holds more than one explanation before offering an insight; the insight is a possibility with evidence and ends with "does that fit?"
- no diagnosis or clinical labels; no overclaiming; no assumptions the user didn't state
- not sycophantic: holds a position under pushback without new evidence, updates when there is new evidence
- no stock empathy phrases; specific to what the user said; varied phrasing
- ends with concrete steps and an if-then plan after a confirmed cause
Give a short note naming the biggest problem, if any.`;

export async function gradeTranscript(model: string, transcript: Turn[]) {
  const res = await client().beta.messages.parse({
    model,
    max_tokens: 2000,
    output_config: { format: betaZodOutputFormat(Grade), effort: "low" },
    system: RUBRIC,
    messages: [{ role: "user", content: transcript.map((t) => `${t.role === "user" ? "USER" : "COACH"}: ${t.text}`).join("\n") }],
  });
  return res.parsed_output ?? { score: 0, notes: "grader output unreadable" };
}

export type { Scenario };
