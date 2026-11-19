import type { Metadata } from "next";
import { Card } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

/**
 * Parent progress emails have been retired. Links in emails sent before then
 * still land here, so they get a clear answer instead of a 404.
 */
export default function UnsubscribePage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">You won&apos;t get any more emails</h1>
        <p className="text-sm text-muted">Progress emails to parents and guardians have stopped. There&apos;s nothing else you need to do.</p>
      </Card>
    </div>
  );
}
