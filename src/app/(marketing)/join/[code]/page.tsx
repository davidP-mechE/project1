import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { JoinButton } from "@/components/classes/join-forms";
import { classByCode, normalizeCode } from "@/server/classes";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Join a class" };

/** An invite link: shows the class, then joins (after logging in or signing up, which comes back here). */
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const code = normalizeCode((await params).code);
  const [c, session] = await Promise.all([classByCode(code), getSession()]);
  const back = encodeURIComponent(`/join/${code}`);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="flex flex-col gap-4">
        {c ? (
          <>
            <h1 className="text-2xl font-semibold">Join {c.name}</h1>
            <p className="text-sm text-muted">
              {c.teacherName || "Your teacher"} invited you to this class on Coursebook. You&apos;ll see the lessons and worksheets they assign, and they&apos;ll see your progress on that work (not your own courses).
            </p>
            {session ? (
              <JoinButton code={code} name={c.name} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/signup?next=${back}`}>Create an account</ButtonLink>
                <ButtonLink href={`/login?next=${back}`} variant="secondary">
                  Log in
                </ButtonLink>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Class not found</h1>
            <p className="text-sm text-muted">This link doesn&apos;t match an open class. Check it with your teacher, or enter the class code under Classes.</p>
            <ButtonLink href="/classes" variant="secondary">
              Go to Classes
            </ButtonLink>
          </>
        )}
      </Card>
    </div>
  );
}
