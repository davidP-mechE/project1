import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { CancelBookingButton, SlotButton } from "@/components/office-hours/forms";
import { NotFoundError } from "@/server/courses";
import { availableSlots, bookableTutors, studentBookings } from "@/server/office-hours";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Office hours" };

/** Students: book time with a tutor, and see, cancel or move your bookings. */
export default async function OfficeHoursPage({ searchParams }: PageProps<"/office-hours">) {
  const user = await requireUser();
  const sp = await searchParams;
  const [tutors, mine, zone] = await Promise.all([bookableTutors(user.id), studentBookings(user.id), viewerZone()]);
  const upcoming = mine.filter((b) => b.upcoming);
  const move = typeof sp.move === "string" ? upcoming.find((b) => b.id === sp.move) : undefined;
  const pick = move ? `${move.staffId}:${move.programId}` : typeof sp.tutor === "string" ? sp.tutor : tutors.length === 1 ? `${tutors[0].staffId}:${tutors[0].programId}` : null;
  const [staffId, programId] = pick ? pick.split(":") : [null, null];
  let slots: Awaited<ReturnType<typeof availableSlots>> | null = null;
  if (staffId && programId) {
    try {
      slots = await availableSlots(user.id, staffId, programId);
    } catch (err) {
      if (err instanceof NotFoundError) notFound();
      throw err;
    }
  }
  const byDay = new Map<string, { start: string; label: string; location: string | null }[]>();
  for (const s of slots?.slots ?? []) {
    const day = formatInZone(s.start, zone, "weekday");
    byDay.set(day, [...(byDay.get(day) ?? []), { start: s.start.toISOString(), label: formatInZone(s.start, zone, "time"), location: s.location }]);
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title="Office hours" description="Book time with one of your tutors. You'll get a confirmation and a reminder the day before. Times are shown in your time zone." />
      {sp.booked === "1" && <Alert tone="success">Booked. It&apos;s on your calendar, and your tutor has been told.</Alert>}
      {mine.length > 0 && (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Your bookings</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{formatInZone(b.startsAt, zone, "full")}</span>
                <span>with {b.staff.name}</span>
                {b.location && <span className="text-muted">{b.location}</span>}
                {b.status === "CANCELLED" ? (
                  <span className="text-muted">Cancelled</span>
                ) : b.upcoming ? (
                  <span className="ml-auto flex items-center gap-1">
                    <Link href={`/office-hours?move=${b.id}`} className="rounded-md px-3 py-1.5 text-sm font-semibold hover:bg-surface-2">Move</Link>
                    <CancelBookingButton bookingId={b.id} />
                  </span>
                ) : (
                  <span className="text-muted">Done</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tutors.length === 0 ? (
        <EmptyState title="No office hours to book yet">When your tutors set times you can book, they show here.</EmptyState>
      ) : (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{move ? `Move your booking with ${move.staff.name}` : "Book a time"}</h2>
          {!move && (
            <nav aria-label="Tutors" className="flex flex-wrap gap-2">
              {tutors.map((t) => {
                const key = `${t.staffId}:${t.programId}`;
                return (
                  <Link key={key} href={`/office-hours?tutor=${key}`} aria-current={key === pick ? "page" : undefined} className={key === pick ? "rounded-md bg-text px-3 py-1.5 text-sm font-semibold text-bg" : "rounded-md border-[1.5px] border-border px-3 py-1.5 text-sm hover:border-text"}>
                    {t.name}
                  </Link>
                );
              })}
            </nav>
          )}
          {move && <p className="text-sm text-muted">Pick a new time. Your current booking stays until the new one is confirmed. <Link href="/office-hours" className="underline">Keep it as it is</Link></p>}
          {!slots ? (
            <p className="text-sm text-muted">Choose a tutor to see their open times.</p>
          ) : byDay.size === 0 ? (
            <p className="text-sm text-muted">No open times in the next four weeks.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {[...byDay.entries()].map(([day, list]) => (
                <li key={day}>
                  <h3 className="mb-1.5 text-sm font-semibold">{day}</h3>
                  <ul className="flex flex-wrap gap-2" aria-label={`Open times on ${day}`}>
                    {list.map((s) => (
                      <li key={s.start}>
                        <SlotButton staffId={staffId!} programId={programId!} start={s.start} label={s.label} moveId={move?.id} />
                      </li>
                    ))}
                  </ul>
                  {list[0].location && <p className="mt-1 text-xs text-muted">{list[0].location}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
