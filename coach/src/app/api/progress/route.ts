import { handle, requireAdult } from "@/server/identity";
import { progressView } from "@/server/views";

export async function GET() {
  return handle(async () => Response.json(await progressView(await requireAdult())));
}
