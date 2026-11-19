import type { Metadata } from "next";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { RuleForm, RuleRow, StaffBookingActions } from "@/components/office-hours/forms";
import { hostingPrograms, myRules, staffBookings, todayIn } from "@/server/office-hours";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";
import { fmtMinutes, WEEKDAYS } from "@/lib/office-hours/slots";

export const metadata: Metadata = { title: "Office hours" };

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Staff: weekly open times, and the bookings students made. */
export default async function StaffOfficeHoursPage() {
  const user = await requireUser();
  const [programs, zone] = await Promise.all([hostingPrograms(user.id), viewerZone()]);
  if (!programs.length) return <div className="mx-auto max-w-3xl"><PageHeader title="Office hours" description="Office hours are for teachers, specialists and program admins." /></div>;
  const [rules, bookings] = await Promise.all([myRules(user.id), staffBookings(user.id)]);
  const today = todayIn(zone);
  const nowIso = new Date(`${today}T00:00:00Z`).toISOString();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title="Office hours" description="Set weekly times students can book. They see open slots, book one (with a note), and can cancel or move it. You both get a confirmation and a reminder the day before, and bookings show on your calendars." />
      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Weekly open times</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-muted">None yet. Add your first below.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rules.map((r) => (
              <li key={r.id} className="py-2">
                <RuleRow
                  ruleId={r.id}
                  today={today}
                  programs={programs}
                  rule={{ programId: r.programId, weekday: r.weekday, start: `${String(Math.floor(r.startMinute / 60)).padStart(2, "0")}:${String(r.startMinute % 60).padStart(2, "0")}`, end: `${String(Math.floor(r.endMinute / 60)).padStart(2, "0")}:${String(r.endMinute % 60).padStart(2, "0")}`, slotMinutes: r.slotMinutes, bufferMinutes: r.bufferMinutes, maxPerDay: r.maxPerDay, validFrom: r.validFrom, validUntil: r.validUntil ?? "", location: r.location ?? "" }}
                  label={`${WEEKDAYS[r.weekday]}s ${fmtMinutes(r.startMinute)}–${fmtMinutes(r.endMinute)} (${r.timezone}) · ${r.slotMinutes}-minute slots${r.bufferMinutes ? `, ${r.bufferMinutes} minutes apart` : ""}, up to ${r.maxPerDay} a day · from ${dayLabel(r.validFrom)}${r.validUntil ? ` to ${dayLabel(r.validUntil)}` : ""}${r.location ? ` · ${r.location}` : ""}${programs.length > 1 ? ` · ${r.program.name}` : ""}`}
                />
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-2 font-semibold">Add an open time</h3>
        <RuleForm programs={programs} today={today} />
      </Card>
      {bookings.length === 0 ? (
        <EmptyState title="No bookings yet">When students book a time, it shows here and on your calendar.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Bookings</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Office-hours bookings, soonest first</caption>
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Student</th>
                  <th className="py-2 pr-3 font-medium">Note</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const upcoming = b.startsAt.toISOString() >= nowIso;
                  return (
                    <tr key={b.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3">
                        {formatInZone(b.startsAt, zone, "full")}
                        {b.staff.id !== user.id && <span className="block text-xs text-muted">with {b.staff.name}</span>}
                        {b.location && <span className="block text-xs text-muted">{b.location}</span>}
                      </td>
                      <td className="py-2 pr-3 font-medium">{b.student.name}</td>
                      <td className="py-2 pr-3 text-muted">{b.note ?? "–"}</td>
                      <td className="py-2">{b.status === "CANCELLED" ? <span className="text-muted">Cancelled</span> : <StaffBookingActions bookingId={b.id} upcoming={upcoming} marked={b.session?.attendance[0]?.status ?? null} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
