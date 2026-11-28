import { handle, HttpError, currentUser } from "@/server/identity";
import { exportAll } from "@/server/store";

export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "No account.");
    const data = await exportAll(user.id);
    return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"` } });
  });
}
