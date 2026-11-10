import { feedFor } from "@/server/calendar";

/**
 * A person's private calendar feed, for Google or Apple Calendar. The token is
 * random and can be reset from the calendar page; events carry titles only.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token } = await ctx.params;
  const ics = await feedFor(token.replace(/\.ics$/, ""));
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" } });
}
