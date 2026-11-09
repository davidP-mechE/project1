import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

// PLACEHOLDER: replace this text with your real Privacy Policy before launch.
export default function Page() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 leading-relaxed">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Placeholder: not legal advice. Last updated: TBD.</p>
      <div className="mt-8 space-y-4"><p>We store your account details (name, email, hashed password), the PDFs you upload, and the courses and study data created from them. Your books are private to you.</p><p>Text from your books is sent to Anthropic’s Claude API to generate lessons, grade answers and answer tutor questions.</p><p>Deleting your account permanently deletes your books, courses and study data.</p><p className="text-muted">[Add the rest of your privacy policy here: data retention, processors, contact details, your rights.]</p></div>
    </article>
  );
}
