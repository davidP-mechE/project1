import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { NewMessageForm } from "@/components/messages/forms";
import { contacts } from "@/server/messages";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "New message" };

export default async function NewMessagePage() {
  const user = await requireUser();
  const c = await contacts(user.id);
  const isStaff = c.staffClasses.length > 0;
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/messages" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Messages
      </Link>
      <PageHeader title="New message" description={isStaff ? "Message one student, or several at once (each gets their own private conversation)." : "Message one of your tutors."} />
      <Card>
        <NewMessageForm contacts={c} />
      </Card>
      <p className="mt-4 text-xs text-muted">Your program admin can read conversations in your program.</p>
    </div>
  );
}
