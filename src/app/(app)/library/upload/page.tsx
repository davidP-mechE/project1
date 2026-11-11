import type { Metadata } from "next";
import { LimitedNotice } from "@/components/limited-notice";
import { allowsCoursebook, programAccess } from "@/server/program-access";
import { requireUser } from "@/server/session";
import { UploadForm } from "@/components/library/upload-form";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Upload a textbook" };

export default async function UploadPage() {
  const access = await programAccess((await requireUser()).id);
  if (!allowsCoursebook(access)) return <LimitedNotice access={access} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Upload a textbook"
        description="Your PDF stays private to your account. Big books can take a few minutes to upload."
      />
      <UploadForm />
    </div>
  );
}
