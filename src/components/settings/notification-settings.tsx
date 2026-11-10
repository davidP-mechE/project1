"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { NOTICE_KINDS, NOTICE_LABELS, type NotificationPrefs } from "@/lib/notification-prefs";
import { saveNotificationPrefsAction } from "@/server/actions/messages";

/** Per kind of notice: show it in the site, email it, both or neither. */
export function NotificationSettings({ initial, isStaff }: { initial: NotificationPrefs; isStaff: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const kinds = NOTICE_KINDS.filter((k) => isStaff || !NOTICE_LABELS[k].staffOnly);
  return (
    <Card>
      <h2 id="notifications" className="scroll-mt-20 text-lg font-semibold">
        Notifications
      </h2>
      <p className="mt-1 text-sm text-muted">What shows under the bell, and what&apos;s also emailed. Emails say who wrote or posted, never the message itself.</p>
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveNotificationPrefsAction(prefs);
            setMsg(r.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: r.error });
          });
        }}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Notification settings</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th scope="col" className="py-2 font-medium">Notice</th>
              <th scope="col" className="w-20 py-2 text-center font-medium">In the site</th>
              <th scope="col" className="w-20 py-2 text-center font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {kinds.map((k) => (
              <tr key={k}>
                <th scope="row" className="py-3 pr-3 font-normal">
                  <span className="font-medium">{NOTICE_LABELS[k].label}</span>
                  <span className="block text-xs text-muted">{NOTICE_LABELS[k].help}</span>
                </th>
                {(["site", "email"] as const).map((ch) => (
                  <td key={ch} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${NOTICE_LABELS[k].label}: ${ch === "site" ? "show in the site" : "email me"}`}
                      checked={prefs[k][ch]}
                      onChange={(e) => setPrefs({ ...prefs, [k]: { ...prefs[k], [ch]: e.target.checked } })}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Save notification settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
