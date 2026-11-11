import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { ClassNav, ROLE_LABEL } from "@/components/classes/class-nav";
import { AddStaffForm, InviteActions, StaffRowActions } from "@/components/classes/staff-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { listStaff } from "@/server/staff";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Staff" };

const when = (d: Date | null, zone: string) => (d ? formatInZone(d, zone, "medium") : "Never");

/** Everyone who teaches, assists or observes this class, with their role and scope. */
export default async function StaffPage({ params }: PageProps<"/teach/[classId]/staff">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { classId } = await params;
  let c, s;
  try {
    [c, s] = await Promise.all([getClassForTeacher(user.id, classId), listStaff(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="staff" />
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Staff</h2>
        <p className="mb-4 text-sm text-muted">
          Part of {s.program.name}. Specialists only see and grade the subjects and students in their scope.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Staff, their roles, scope and last login</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                <th scope="col" className="py-2 pr-3 font-medium">Covers</th>
                {s.manage && <th scope="col" className="py-2 pr-3 font-medium">Last login</th>}
                {s.manage && <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.staff.map((p) => (
                <tr key={p.userId} className="align-top">
                  <th scope="row" className="py-3 pr-3 font-medium">
                    {p.name || "Staff member"}
                    {p.email && <span className="block text-xs font-normal text-muted">{p.email}</span>}
                  </th>
                  <td className="py-3 pr-3">
                    {ROLE_LABEL[p.role]}
                    {p.canManageStaff && p.role === "TEACHER" && <span className="block text-xs text-muted">Can manage staff</span>}
                  </td>
                  <td className="py-3 pr-3">{p.scopeText}</td>
                  {s.manage && <td className="py-3 pr-3 whitespace-nowrap">{when(p.lastLoginAt, zone)}</td>}
                  {s.manage && (
                    <td className="py-3">
                      {!p.isProgramAdmin && (
                        <StaffRowActions
                          classId={classId}
                          person={{ userId: p.userId, name: p.name || "this person", role: p.role as "TEACHER" | "SPECIALIST" | "VIEWER", sections: p.sections, domains: p.domains, groupIds: p.groupIds, canManageStaff: p.canManageStaff }}
                          groups={s.groups}
                          isAdmin={s.isAdmin}
                          isSelf={p.userId === user.id}
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.invites.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 font-semibold">Invited, not joined yet</h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {s.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {i.email} · {ROLE_LABEL[i.role]} · {i.scopeText}
                    <span className={i.expired ? "block text-xs text-danger" : "block text-xs text-muted"}>{i.expired ? `Expired ${when(i.expiresAt, zone)}` : `Link works until ${when(i.expiresAt, zone)}`}</span>
                  </span>
                  <InviteActions classId={classId} inviteId={i.id} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {s.manage ? (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Add someone</h2>
          <p className="mb-4 text-sm text-muted">If they already have a Coursebook account they get access right away; otherwise they get an invite link to sign up.</p>
          <AddStaffForm classId={classId} groups={s.groups} isAdmin={s.isAdmin} />
        </Card>
      ) : (
        <p className="text-sm text-muted">Only the program admin{s.isAdmin ? "" : " (or a teacher they allow)"} can add, change or remove staff.</p>
      )}
    </div>
  );
}
