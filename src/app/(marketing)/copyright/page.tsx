import type { Metadata } from "next";

export const metadata: Metadata = { title: "Copyright & Takedown" };

// PLACEHOLDER: replace this text with your real Copyright & Takedown before launch.
export default function Page() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 leading-relaxed">
      <h1 className="text-3xl font-bold tracking-tight">Copyright & Takedown</h1>
      <p className="mt-2 text-sm text-muted">Placeholder: not legal advice. Last updated: TBD.</p>
      <div className="mt-8 space-y-4"><p>Coursebook users may only upload material they have the right to use. Uploaded files are private and are not distributed to other users.</p><p>If you believe content on Coursebook infringes your copyright, contact our designated agent:</p><p className="rounded-lg border border-border bg-surface p-4">[Name]<br />[Postal address]<br />[Email: copyright@example.com]</p><p>Please include: identification of the copyrighted work, the location of the infringing material if known, your contact information, a good-faith statement, and a statement under penalty of perjury that you are authorized to act for the copyright owner.</p></div>
    </article>
  );
}
