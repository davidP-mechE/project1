import { handle, requireAdult } from "@/server/identity";
import { openSession, sessionMessages } from "@/server/store";
import { startSession } from "@/server/coach";

const shape = (messages: Awaited<ReturnType<typeof sessionMessages>>) => messages.map((m) => ({ id: m.id, role: m.role, text: m.text, feedback: m.feedback }));

/** The open session, if any. */
export async function GET() {
  return handle(async () => {
    const user = await requireAdult();
    const s = await openSession(user.id);
    if (!s) return Response.json({ session: null });
    return Response.json({ session: { id: s.id, stage: s.state.stage, crisis: s.crisis }, messages: shape(await sessionMessages(s.id)) });
  });
}

/** Start (or resume) a session. Limits apply here, never mid-session. */
export async function POST() {
  return handle(async () => {
    const user = await requireAdult();
    const { session, messages } = await startSession(user);
    return Response.json({ session: { id: session.id, stage: session.state.stage, crisis: session.crisis }, messages: shape(messages) });
  });
}
