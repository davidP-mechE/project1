import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { InputsForm } from "@/components/academic-index/inputs-form";
import { Disclaimer } from "@/components/academic-index/result-view";
import { getAcademicIndex } from "@/server/academic-index";
import { getEssayGrader } from "@/server/ai/academic-index";
import { isNoAi } from "@/server/program-access";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Academic Index answers" };
// Scoring reads each essay three times with Claude; give it time.
export const maxDuration = 300;

/** The inputs form, which is also the review screen after an import. */
export default async function InputsPage({ searchParams }: PageProps<"/academic-index/inputs">) {
  const user = await requireUser();
  const [s, noAi, sp] = await Promise.all([getAcademicIndex(user.id), isNoAi(user.id), searchParams]);
  if (s.ageCheck !== "PASSED") redirect("/academic-index");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <p className="text-sm"><Link href="/academic-index" className="text-muted hover:text-text hover:underline">← Academic Index</Link></p>
      <PageHeader title={sp.review === "1" ? "Check what we read" : "Your application"} description="Everything here is private to you. Your draft saves when you press Save draft or score." />
      <Disclaimer />
      <InputsForm initial={s.inputs} initialSources={s.sources} keepEssays={s.keepEssays} essaysAvailable={!noAi && getEssayGrader() !== null} review={sp.review === "1"} />
    </div>
  );
}
