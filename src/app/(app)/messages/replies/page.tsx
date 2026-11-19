import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { NewReply, ReplyRow } from "@/components/messages/manage";
import { listSavedReplies } from "@/server/saved-replies";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Saved replies" };

/** Staff: write, share and manage reusable messages. */
export default async function SavedRepliesPage() {
  const user = await requireUser();
  const { replies, programs } = await listSavedReplies(user.id);
  if (!programs.length) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Saved replies" description="Saved replies are for tutors and staff." />
      </div>
    );
  }
  const options = programs.map((p) => ({ id: p.id, name: p.name }));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm"><Link href="/messages" className="text-muted hover:text-text hover:underline">← Messages</Link></p>
      <PageHeader title="Saved replies" description="Messages you send often. Insert them when writing a message, a group message or an announcement. Placeholders are filled in for each student when it's sent. Share one with your program so every tutor there can use it." />
      <Card>
        <h2 className="mb-3 text-lg font-semibold">New saved reply</h2>
        <NewReply programs={options} />
      </Card>
      {replies.length === 0 ? (
        <EmptyState title="No saved replies yet">Ones you save, and ones shared with your program, appear here.</EmptyState>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {replies.map((r) => (
              <li key={r.id} className="py-3">
                <ReplyRow reply={{ id: r.id, title: r.title, body: r.body, programId: r.programId, programName: r.programName, canEdit: r.canEdit, ownerName: r.owner.name }} programs={options} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
