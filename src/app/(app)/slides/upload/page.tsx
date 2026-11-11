import type { Metadata } from "next";
import { LimitedNotice } from "@/components/limited-notice";
import { allowsCoursebook, programAccess } from "@/server/program-access";
import { requireUser } from "@/server/session";
import { UploadForm } from "@/components/library/upload-form";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Upload slides" };

export default async function UploadSlidesPage() {
  const access = await programAccess((await requireUser()).id);
  if (!allowsCoursebook(access)) return <LimitedNotice access={access} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Upload slides"
        description="A PDF or PowerPoint (.pptx) file. From Google Slides or Keynote, use File → Download → PDF: it keeps the slides' look exactly. PowerPoint files also bring in your speaker notes."
      />
      <UploadForm kind="slides" />
    </div>
  );
}
