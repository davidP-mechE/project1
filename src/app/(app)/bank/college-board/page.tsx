import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { CollegeBoardUpload } from "@/components/bank/college-board-upload";
import { requireUser } from "@/server/session";
import { canAuthor } from "@/server/bank";

export const metadata: Metadata = { title: "College Board questions" };

export default async function CollegeBoardPage() {
  const user = await requireUser();
  if (!(await canAuthor(user.id))) notFound();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <p className="text-sm">
        <Link href="/bank" className="text-muted hover:underline">← Question bank</Link>
      </p>
      <PageHeader
        title="College Board questions"
        description="Upload official College Board questions as a PDF, screenshots or pasted text. Claude copies each question word for word, leaves out the page clutter (question IDs, headers, page numbers, Bluebook buttons) and tags its section, skill and difficulty. Check them, then add the ones you want to the bank as drafts."
      />
      <Card className="flex flex-col gap-2 text-sm text-muted">
        <p>Nothing is saved until you choose Add. Questions with a College Board question ID are never added twice.</p>
        <p>Graphs and pictures can&apos;t be copied as text: those questions are marked, and you add the image in the editor afterwards. Tables come through as tables.</p>
        <p>These questions stay inside your program&apos;s practice sets. Use them as College Board&apos;s terms allow for teaching your own students, and don&apos;t post them publicly.</p>
      </Card>
      <Card>
        <CollegeBoardUpload />
      </Card>
    </div>
  );
}
