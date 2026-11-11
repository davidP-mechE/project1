import type { Metadata } from "next";
import { Card } from "@/components/ui/misc";
import { unsubscribeGuardian } from "@/server/cohort";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

/** One-click unsubscribe for guardians' weekly emails. */
export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  const ok = await unsubscribeGuardian(token);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{ok ? "You're unsubscribed" : "Link not recognized"}</h1>
        <p className="text-sm text-muted">{ok ? "You won't get any more weekly progress emails. If this was a mistake, ask the tutor to add you again." : "This unsubscribe link doesn't match any email list. You may already be removed."}</p>
      </Card>
    </div>
  );
}
