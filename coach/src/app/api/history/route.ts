import { handle, requireAdult } from "@/server/identity";
import { historyView } from "@/server/views";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireAdult();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return Response.json({ sessions: await historyView(user, q) });
  });
}
