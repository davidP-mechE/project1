import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/misc";
import { ReplyForm } from "@/components/messages/forms";
import { getThread } from "@/server/messages";
import { NotFoundError } from "@/server/courses";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage({ params, searchParams }: PageProps<"/messages/[threadId]">) {
  const user = await requireUser();
  const { threadId } = await params;
  const { before } = await searchParams;
  const zone = await viewerZone();
  let data;
  try {
    data = await getThread(user.id, threadId, { before: typeof before === "string" ? before : undefined });
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { thread, viewer, messages, older } = data;
  const title = viewer.mode === "admin" ? `${thread.staffName} and ${thread.studentName}` : viewer.mode === "student" ? thread.staffName : thread.studentName;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/messages" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Messages
      </Link>
      <PageHeader title={title} description={thread.className} />
      {viewer.mode === "admin" && <Alert tone="info">You&apos;re reading this as the program admin. You can&apos;t reply here.</Alert>}
      {older && (
        <Link href={`/messages/${thread.id}?before=${older}`} className="self-center text-sm text-primary underline">
          Earlier messages
        </Link>
      )}
      <Card>
        <ol className="flex flex-col gap-3" aria-label="Messages">
          {messages.map((m) => {
            const mine = m.authorId === user.id;
            const who = m.authorId === thread.staffId ? thread.staffName : thread.studentName;
            return (
              <li key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                <div className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm", mine ? "bg-primary text-primary-text" : "bg-surface-2 text-text")}>{m.body}</div>
                <span className="mt-1 text-xs text-muted">
                  {mine ? "You" : who} · <time dateTime={m.createdAt.toISOString()}>{formatInZone(m.createdAt, zone, "dayTime")}</time>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>
      {viewer.canReply ? (
        <Card>
          <ReplyForm threadId={thread.id} />
        </Card>
      ) : (
        viewer.mode !== "admin" && <Alert tone="info">This conversation is closed: the student or tutor is no longer in this class or group.</Alert>
      )}
      <p className="text-xs text-muted">Your program admin can read conversations in your program.</p>
    </div>
  );
}
