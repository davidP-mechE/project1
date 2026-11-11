import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { listThreads } from "@/server/messages";
import { db } from "@/server/db";
import { requireUser, viewerZone } from "@/server/session";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const user = await requireUser();
  const sp = await searchParams;
  const isProgramAdmin = (await db.program.count({ where: { adminId: user.id } })) > 0;
  const view = sp.view === "program" && isProgramAdmin ? "program" : "mine";
  const before = typeof sp.before === "string" ? sp.before : undefined;
  const [{ threads, next }, zone] = await Promise.all([listThreads(user.id, { view, before }), viewerZone()]);
  const qs = (extra: Record<string, string>) => `/messages?${new URLSearchParams({ ...(view === "program" ? { view } : {}), ...extra })}`;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Messages" description="Conversations between students and their tutors." actions={<ButtonLink href="/messages/new">New message</ButtonLink>} />
      <p role="note" className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
        Your program admin can read conversations in your program, to keep everyone safe. Please don&apos;t share passwords or anything private.
      </p>
      {isProgramAdmin && (
        <nav aria-label="Conversations" className="mb-4 flex gap-2 text-sm">
          {(["mine", "program"] as const).map((v) => (
            <Link key={v} href={v === "program" ? "/messages?view=program" : "/messages"} aria-current={view === v ? "page" : undefined} className={cn("rounded border px-3 py-1", view === v ? "border-primary bg-primary text-primary-text" : "border-border")}>
              {v === "mine" ? "My conversations" : "Everyone in the program"}
            </Link>
          ))}
        </nav>
      )}
      {threads.length === 0 ? (
        <EmptyState title="No conversations yet" action={<ButtonLink href="/messages/new" variant="secondary">Write a message</ButtonLink>}>
          {view === "program" ? "When tutors and students message each other, the conversations show here." : "Messages between you and your tutors or students show up here."}
        </EmptyState>
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-border">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`/messages/${t.id}`} className="flex items-start gap-3 rounded-lg px-3 py-3 hover:bg-surface-2">
                  <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", t.unread ? "bg-accent" : "bg-transparent")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2">
                      <span className={cn("truncate text-sm", t.unread && "font-semibold")}>
                        {t.other}
                        {t.unread && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{relativeTime(t.lastMessageAt, zone)}</span>
                    </span>
                    <span className="block text-xs text-muted">{t.className}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{t.preview}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {before ? <Link href={qs({})} className="text-primary underline">Newest</Link> : <span />}
        {next && <Link href={qs({ before: next })} className="text-primary underline">Older</Link>}
      </div>
    </div>
  );
}
