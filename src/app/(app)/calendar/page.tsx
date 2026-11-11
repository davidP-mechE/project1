import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { SubscribeLink } from "@/components/calendar/subscribe";
import { calendarEvents, feedToken, type CalEvent } from "@/server/calendar";
import { env } from "@/server/env";
import { requireUser, viewerZone } from "@/server/session";
import { dayKey, formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

const KIND: Record<CalEvent["kind"], { label: string; dot: string }> = {
  DUE: { label: "Due", dot: "bg-chart-1" },
  OPENS: { label: "Opens", dot: "bg-chart-3" },
  CLOSES: { label: "Closes", dot: "bg-chart-4" },
  SESSION: { label: "Session", dot: "bg-chart-5" },
  UNIT: { label: "Unit", dot: "bg-chart-2" },
  TEST: { label: "Test day", dot: "bg-danger" },
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Whole-day items are calendar dates (stored as UTC midnight); timed ones fall on the viewer's day. */
const keyOf = (e: CalEvent, zone: string) => (e.allDay ? e.start.toISOString().slice(0, 10) : dayKey(e.start, zone));
const timeOf = (e: CalEvent, zone: string) => (e.allDay ? (e.kind === "UNIT" && e.end ? `until ${formatInZone(e.end, "UTC", "day")}` : "All day") : formatInZone(e.start, zone, "time"));

function parseMonth(raw: unknown, zone: string) {
  const today = dayKey(new Date(), zone);
  const m = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : today.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  return { y, mo, key: m, today };
}
const monthKey = (y: number, mo: number) => `${y}-${String(mo).padStart(2, "0")}`;

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const sp = await searchParams;
  const { y, mo, key, today } = parseMonth(sp.month, zone);
  const view = sp.view === "agenda" ? "agenda" : "auto";
  // A week either side covers every timezone and the grid's leading and trailing days.
  const from = new Date(Date.UTC(y, mo - 1, 1) - 7 * 86_400_000);
  const to = new Date(Date.UTC(y, mo, 1) + 7 * 86_400_000);
  const [events, token] = await Promise.all([calendarEvents(user.id, from, to), feedToken(user.id)]);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const k = keyOf(e, zone);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const prev = mo === 1 ? monthKey(y - 1, 12) : monthKey(y, mo - 1);
  const next = mo === 12 ? monthKey(y + 1, 1) : monthKey(y, mo + 1);
  const title = first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const agendaDays = [...byDay.keys()].filter((k) => k.startsWith(key)).sort();
  const q = (extra: Record<string, string>) => `/calendar?${new URLSearchParams({ ...(view === "agenda" ? { view } : {}), ...extra })}`;

  const agenda = (
    <section aria-label={`Agenda, ${title}`} className="flex flex-col gap-3">
      {agendaDays.length === 0 ? (
        <EmptyState title="Nothing this month">Due dates, sessions, diagnostics and curriculum units show up here.</EmptyState>
      ) : (
        agendaDays.map((d) => (
          <Card key={d} className={cn("p-4", d === today && "border-accent")}>
            <h2 className="text-sm font-semibold">
              {formatInZone(new Date(`${d}T12:00:00Z`), "UTC", "weekday")}
              {d === today && <span className="ml-2 text-xs font-normal text-accent-ink">Today</span>}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {byDay.get(d)!.map((e) => (
                <li key={e.id} className="flex items-start gap-3 text-sm">
                  <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", KIND[e.kind].dot)} />
                  <span className="w-20 shrink-0 text-muted">{timeOf(e, zone)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{KIND[e.kind].label}: </span>
                    {e.href ? (
                      <Link href={e.href as never} className="underline-offset-2 hover:underline">
                        {e.title}
                      </Link>
                    ) : (
                      e.title
                    )}
                    {e.className && <span className="block text-xs text-muted">{e.className}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </section>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Calendar" description={`Times are in your timezone (${zone}).`} />
      <nav aria-label="Months" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={q({ month: prev })} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            ← <span className="sr-only">Previous month</span>
          </Link>
          <h2 className="min-w-40 text-center font-display text-xl font-semibold" aria-live="polite">
            {title}
          </h2>
          <Link href={q({ month: next })} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
            → <span className="sr-only">Next month</span>
          </Link>
          {key !== today.slice(0, 7) && (
            <Link href={q({})} className="text-sm text-primary underline">
              This month
            </Link>
          )}
        </div>
        <div className="flex gap-2 text-sm">
          <Link href={`/calendar?month=${key}`} aria-current={view === "auto" ? "page" : undefined} className={cn("rounded-full border px-3 py-1", view === "auto" ? "border-primary bg-primary text-primary-text" : "border-border")}>
            Month
          </Link>
          <Link href={`/calendar?month=${key}&view=agenda`} aria-current={view === "agenda" ? "page" : undefined} className={cn("rounded-full border px-3 py-1", view === "agenda" ? "border-primary bg-primary text-primary-text" : "border-border")}>
            Agenda
          </Link>
        </div>
      </nav>
      <ul aria-label="Key" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {Object.values(KIND).map((k) => (
          <li key={k.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2.5 rounded-full", k.dot)} />
            {k.label}
          </li>
        ))}
      </ul>

      {view === "agenda" ? (
        agenda
      ) : (
        <>
          {/* Phones: the agenda. Wider screens: the month grid. */}
          <div className="md:hidden">{agenda}</div>
          <table className="hidden w-full table-fixed border-collapse md:table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col" className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: cells.length / 7 }, (_, w) => (
                <tr key={w}>
                  {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                    const list = d ? (byDay.get(d) ?? []) : [];
                    return (
                      <td key={i} className={cn("h-28 border border-border p-1.5 align-top", d ? "bg-surface" : "bg-surface-2/50", d === today && "outline outline-2 -outline-offset-2 outline-accent")}>
                        {d && (
                          <>
                            <span className={cn("text-xs", d === today ? "font-bold text-accent-ink" : "text-muted")}>
                              {Number(d.slice(8))}
                              {d === today && <span className="sr-only"> (today)</span>}
                            </span>
                            <ul className="mt-1 flex flex-col gap-0.5">
                              {list.slice(0, 3).map((e) => (
                                <li key={e.id} className="flex items-center gap-1 truncate text-xs" title={`${KIND[e.kind].label}: ${e.title}${e.className ? ` (${e.className})` : ""}`}>
                                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", KIND[e.kind].dot)} />
                                  <span className="sr-only">{KIND[e.kind].label}: </span>
                                  {e.href ? (
                                    <Link href={e.href as never} className="truncate hover:underline">
                                      {e.title}
                                    </Link>
                                  ) : (
                                    <span className="truncate">{e.title}</span>
                                  )}
                                </li>
                              ))}
                              {list.length > 3 && <li className="text-xs text-muted">+{list.length - 3} more</li>}
                            </ul>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">Add to your own calendar</h2>
        <SubscribeLink base={env.APP_URL} initialToken={token} />
      </Card>
    </div>
  );
}
