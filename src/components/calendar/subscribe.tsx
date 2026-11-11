"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { resetCalendarLinkAction } from "@/server/actions/messages";

/** The private feed link, with copy and reset (which revokes the old link). */
export function SubscribeLink({ base, initialToken }: { base: string; initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const url = `${base}/api/calendar/${token}.ics`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="feed-url" className="text-sm font-medium">
        Your private calendar link
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="feed-url" readOnly value={url} className={`${inputClasses} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => setNote("Copied."), () => setNote("Select the link and copy it."))}>
            Copy
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              confirm("Make a new link? Calendars using the old one stop updating.") &&
              start(async () => {
                const r = await resetCalendarLinkAction();
                if (r.ok) {
                  setToken(r.token);
                  setNote("New link made. The old one no longer works.");
                } else setNote(r.error);
              })
            }
          >
            Reset link
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted" role="status">
        {note ?? "Add it in Google Calendar (Other calendars → From URL) or Apple Calendar (File → New Calendar Subscription). Anyone with the link can see your calendar's titles, so keep it to yourself."}
      </p>
    </div>
  );
}
