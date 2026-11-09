import { unsubscribe } from "@/server/reminders";

/** One-click "turn off reminders" link from the email. Signed, so it can't be used for other accounts. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ok = await unsubscribe(url.searchParams.get("u") ?? "", url.searchParams.get("s") ?? "");
  const body = ok
    ? "Daily reminders are turned off. You can turn them back on any time in Coursebook → Settings."
    : "This link isn't valid. You can turn reminders off in Coursebook → Settings.";
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reminders</title><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;line-height:1.5"><h1 style="font-size:20px">Coursebook</h1><p>${body}</p><p><a href="/settings">Go to Settings</a></p>`, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
