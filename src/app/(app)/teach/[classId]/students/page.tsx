import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import {
  ArchiveClassButton,
  CancelInviteButton,
  CopyButton,
  InviteForm,
  NewCodeButton,
  RemoveStudentButton,
  RenameClassForm,
} from "@/components/classes/teacher-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Students" };

const day = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Who's in the class, how to get students in, and the class's settings. */
export default async function StudentsPage({
  params,
}: PageProps<"/teach/[classId]/students">) {
  const user = await requireUser();
  const { classId } = await params;
  let c;
  try {
    c = await getClassForTeacher(user.id, classId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const manage = c.access.role === "ADMIN" || c.access.role === "TEACHER";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="students" />
      {manage && (
        <Card className="flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-semibold">Get students in</h2>
            <p className="text-sm text-muted">
              Students enter the code under Classes, or open the link. Invited
              students get the link by email.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-lg border border-border bg-surface-2 px-4 py-2 font-mono text-2xl font-semibold tracking-[0.2em]"
              aria-label={`Class code ${c.joinCode.split("").join(" ")}`}
            >
              {c.joinCode}
            </span>
            <CopyButton text={c.joinCode} label="Copy code" />
            <CopyButton text={c.joinUrl} label="Copy invite link" />
            <NewCodeButton classId={c.id} />
          </div>
          <InviteForm classId={c.id} />
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-lg font-semibold">
          Students{" "}
          <span className="text-base font-normal text-muted">
            ({c.members.length})
          </span>
        </h2>
        {c.members.length === 0 ? (
          <p className="text-sm text-muted">No one has joined yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {c.members.map((m) => (
              <li
                key={m.user.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {m.user.name || "Student"}
                  </span>{" "}
                  <span className="text-muted">{m.user.email}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  Joined {day(m.joinedAt)}
                  {manage && (
                    <RemoveStudentButton
                      classId={c.id}
                      studentId={m.user.id}
                      name={m.user.name || m.user.email || "this student"}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {c.invites.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 font-semibold">Invited, not joined yet</h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {c.invites.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="text-muted">
                    {i.email} · sent {day(i.createdAt)}
                  </span>
                  <CancelInviteButton classId={c.id} inviteId={i.id} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {manage && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Class settings</h2>
          <RenameClassForm classId={c.id} name={c.name} />
          <div>
            <ArchiveClassButton
              classId={c.id}
              archived={Boolean(c.archivedAt)}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
