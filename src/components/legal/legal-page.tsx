import type { ReactNode } from "react";
import { env } from "@/server/env";

/** Shared layout for the Terms, Privacy and Copyright pages, with a table of contents. */
export function LegalPage({ title, intro, sections, draft }: { title: string; intro: ReactNode; sections: { id: string; title: string; body: ReactNode }[]; draft?: string[] }) {
  return (
    <article className="legal mx-auto max-w-3xl px-4 py-12 leading-relaxed">
      {draft && (
        <div role="note" className="mb-8 rounded-xl border-2 border-dashed border-warning bg-warning-bg p-4 text-sm text-warning">
          <p className="font-bold">DRAFT: not final. To be completed with the school before real students use the site.</p>
          <p className="mt-1">Still to decide:</p>
          <ul className="mt-1 list-disc pl-5">
            {draft.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <p className="mt-2">See PRIVACY_REVIEW.md in the project for the checklist.</p>
        </div>
      )}
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated: {env.LEGAL_UPDATED}</p>
      <div className="mt-6 space-y-4">{intro}</div>
      <nav aria-label="On this page" className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="mb-2 font-medium">On this page</p>
        <ol className="list-decimal space-y-1 pl-5">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline-offset-2 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((s, i) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-20 space-y-3">
          <h2 id={`${s.id}-h`} className="text-xl font-semibold">
            {i + 1}. {s.title}
          </h2>
          {s.body}
        </section>
      ))}
    </article>
  );
}

/** The contact email as a link, or a visible reminder for the operator to set it. */
export function ContactEmail({ fallback = "CONTACT_EMAIL" }: { fallback?: string }) {
  if (!env.CONTACT_EMAIL) return <span className="rounded bg-warning-bg px-1 text-warning">[set {fallback} on the server]</span>;
  return (
    <a className="underline" href={`mailto:${env.CONTACT_EMAIL}`}>
      {env.CONTACT_EMAIL}
    </a>
  );
}

export const legalName = () => env.LEGAL_NAME;
