import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { AcceptInviteButton } from "@/components/classes/staff-forms";
import { ROLE_LABEL } from "@/components/classes/class-nav";
import { staffInviteByToken } from "@/server/staff";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Staff invitation", robots: { index: false } };

/** A staff invite link: sign up or log in with the invited address, then accept. */
export default async function StaffInvitePage({ params }: PageProps<"/staff-invite/[token]">) {
  const { token } = await params;
  const [inv, session] = await Promise.all([staffInviteByToken(token), getSession()]);
  const back = encodeURIComponent(`/staff-invite/${token}`);
  const wrongAccount = inv && session && session.user.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="flex flex-col gap-4">
        {!inv || inv.state !== "pending" ? (
          <>
            <h1 className="text-2xl font-semibold">{inv?.state === "expired" ? "This invite has expired" : inv?.state === "accepted" ? "This invite has been used" : "Invite not found"}</h1>
            <p className="text-sm text-muted">
              {inv?.state === "accepted" ? "If it was yours, the class is under Teaching." : "Ask the program admin to send you a new one."}
            </p>
            <ButtonLink href="/teach" variant="secondary">
              Go to Teaching
            </ButtonLink>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Join {inv.className}&apos;s staff</h1>
            <p className="text-sm text-muted">
              You&apos;ve been invited as {ROLE_LABEL[inv.role]} for {inv.email}.
            </p>
            {!session ? (
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/signup?next=${back}`}>Create an account</ButtonLink>
                <ButtonLink href={`/login?next=${back}`} variant="secondary">
                  Log in
                </ButtonLink>
              </div>
            ) : wrongAccount ? (
              <p className="text-sm">You&apos;re logged in as {session.user.email}. Log out, then log in or sign up as {inv.email} to accept.</p>
            ) : (
              <AcceptInviteButton token={token} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}
