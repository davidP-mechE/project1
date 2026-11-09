import type { Metadata } from "next";
import { UploadForm } from "@/components/library/upload-form";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Upload a textbook" };

export default function UploadPage() {
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
