import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { AutoRefresh, ImportForm, RemoveUploadButton, ReviewButton } from "@/components/academic-index/import-form";
import { getAcademicIndex } from "@/server/academic-index";
import { isNoAi, NO_AI_MESSAGE } from "@/server/program-access";
import { requireUser, viewerZone } from "@/server/session";
import { FILE_TYPES, type FileType } from "@/lib/academic-index/extraction";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Import application PDFs" };

const STATUS: Record<string, string> = {
  UPLOADED: "Reading…",
  EXTRACTED: "Read: ready to review",
  CONFIRMED: "Reviewed · PDF deleted",
  DELETED: "PDF deleted",
  FAILED: "Couldn't be read",
};

/** Upload application PDFs; Coursebook reads them and fills the form for the student to check. */
export default async function ImportPage() {
  const user = await requireUser();
  const [s, noAi, zone] = await Promise.all([getAcademicIndex(user.id), isNoAi(user.id), viewerZone()]);
  if (s.ageCheck !== "PASSED") redirect("/academic-index");
  const active = s.uploads.filter((u) => ["UPLOADED", "EXTRACTED"].includes(u.status));
  const toReview = s.uploads.filter((u) => u.status === "EXTRACTED" && !u.appliedAt);
  const reading = s.uploads.some((u) => u.status === "UPLOADED");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm"><Link href="/academic-index" className="text-muted hover:text-text hover:underline">← Academic Index</Link></p>
      <PageHeader title="Import your application" description="Upload your application PDFs. Coursebook reads them and fills in the form; you check every field before anything is scored. Your PDFs are deleted as soon as you confirm, or after 24 hours." />
      <AutoRefresh active={reading} />
      {noAi ? (
        <Alert tone="info">{NO_AI_MESSAGE} You can still <Link href="/academic-index/inputs" className="font-semibold underline">enter everything by hand</Link>.</Alert>
      ) : (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Upload a PDF</h2>
          <ImportForm activeCount={active.length} />
        </Card>
      )}
      {s.uploads.length > 0 && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your files</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {s.uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{FILE_TYPES[u.fileType as FileType]?.label ?? u.fileType}</span>
                <span className="text-muted">{formatInZone(u.uploadedAt, zone, "dayTime")}</span>
                <span className={u.status === "FAILED" ? "text-danger" : u.status === "EXTRACTED" ? "font-semibold" : "text-muted"}>
                  {u.status === "EXTRACTED" && u.appliedAt ? "On your review screen" : STATUS[u.status] ?? u.status}
                  {u.pageCount ? ` · ${u.pageCount} page${u.pageCount === 1 ? "" : "s"}` : ""}
                </span>
                {u.error && <span className="basis-full text-xs text-muted">{u.error}</span>}
                {!u.deletedAt && <span className="ml-auto"><RemoveUploadButton uploadId={u.id} /></span>}
              </li>
            ))}
          </ul>
          {toReview.length > 0 ? (
            <ReviewButton count={toReview.length} />
          ) : (
            s.uploads.some((u) => u.status === "EXTRACTED" && u.appliedAt) && (
              <p className="text-sm"><Link href="/academic-index/inputs?review=1" className="font-semibold underline">Go to your review screen</Link></p>
            )
          )}
        </Card>
      )}
      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="text-lg font-semibold">What you can upload</h2>
        <ul className="flex flex-col gap-2">
          {(Object.keys(FILE_TYPES) as FileType[]).map((k) => (
            <li key={k}>
              <strong>{FILE_TYPES[k].long}</strong>: {FILE_TYPES[k].where}. <span className="text-muted">Fills in {FILE_TYPES[k].fills.toLowerCase()}.</span>
            </li>
          ))}
        </ul>
        <p className="text-muted">Your PDFs are read only to fill in this form. They&apos;re never used to train anything.</p>
      </Card>
    </div>
  );
}
