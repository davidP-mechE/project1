import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { Markdown } from "@/components/lesson/markdown";
import { ChooseVersionButtons } from "@/components/studio/review-forms";
import { requireOwner } from "@/server/owner-guard";
import { TEXT_FILTERS, transcriptionCounts, transcriptionList, type TextFilter } from "@/server/transcriptions";

export const metadata: Metadata = { title: "Transcriptions", robots: { index: false, follow: false } };

const LABEL: Record<TextFilter, string> = { review: "Needs review", auto_text: "Shown as text", approved_text: "Text (you chose)", kept_image: "Image (you chose)" };

/** Question Bank items Claude turned into text: check each against its image, then use the text or keep the image. */
export default async function TranscriptionsPage({ searchParams }: PageProps<"/studio/transcriptions">) {
  const owner = await requireOwner();
  const sp = await searchParams;
  const filter: TextFilter = (TEXT_FILTERS as readonly string[]).includes(String(sp.status)) ? (sp.status as TextFilter) : "review";
  const page = Math.max(1, Number(sp.page) || 1);
  const [counts, list] = await Promise.all([transcriptionCounts(owner.id), transcriptionList(owner.id, filter, page)]);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/studio" className="text-muted hover:underline">← Course Studio</Link>
      </p>
      <PageHeader
        eyebrow="Owner only"
        title="Transcriptions"
        description="Image-only Question Bank items that Claude turned into text. An item is shown as text only if Claude's own answer matched the official key and its math renders; the rest wait here with the image still showing. Compare each with its image."
      />
      <nav aria-label="Filter" className="flex flex-wrap gap-2 text-sm">
        {TEXT_FILTERS.map((f) => (
          <Link key={f} href={`/studio/transcriptions?status=${f}`} aria-current={filter === f ? "page" : undefined} className={filter === f ? "rounded-md bg-text px-3 py-1.5 font-semibold text-bg" : "rounded-md border-[1.5px] border-border px-3 py-1.5 hover:border-text"}>
            {LABEL[f]} ({counts[f]})
          </Link>
        ))}
      </nav>
      {list.rows.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
      {list.rows.map((q) => (
        <Card key={q.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              <Link href={`/bank/${q.id}`} className="hover:underline">{q.externalId}</Link>
              <span className="font-normal text-muted"> · {q.skill?.name ?? "No skill"} · key {q.answer.split("|").join(", ")}</span>
            </p>
            <ChooseVersionButtons questionId={q.id} status={q.textStatus} />
          </div>
          {q.transcriptIssues.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-warning">
              {q.transcriptIssues.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="eyebrow">Image</p>
              {q.versions.image.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={q.versions.image.imageUrl} alt="The question as printed" loading="lazy" className="h-auto max-w-full rounded border border-border bg-white" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="eyebrow">Text</p>
              <div className="rounded border border-border p-3">
                <Markdown>{q.versions.text.stem}</Markdown>
                {q.versions.text.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.versions.text.imageUrl} alt={q.versions.text.imageAlt ?? "Figure"} loading="lazy" className="my-2 max-h-72 max-w-full rounded border border-border bg-white" />
                )}
                {q.versions.text.choices.length > 0 && (
                  <ol className="mt-2 list-[upper-alpha] pl-6 text-sm">
                    {q.versions.text.choices.map((c, i) => (
                      <li key={i}>
                        <Markdown>{c}</Markdown>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
          {(q.versions.text.explanation || q.versions.image.rationaleImageUrl) && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Explanation: image and text</summary>
              <div className="mt-2 grid gap-4 lg:grid-cols-2">
                <div>
                  {q.versions.image.rationaleImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.versions.image.rationaleImageUrl} alt="The explanation as printed" loading="lazy" className="h-auto max-w-full rounded border border-border bg-white" />
                  ) : (
                    <p className="text-muted">(No explanation image: the text came with the bank.)</p>
                  )}
                </div>
                <div className="rounded border border-border p-3">
                  <Markdown>{q.versions.text.explanation}</Markdown>
                </div>
              </div>
            </details>
          )}
        </Card>
      ))}
      {list.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {page > 1 && <Link href={`/studio/transcriptions?status=${filter}&page=${page - 1}`} className="underline">Previous</Link>}
          <span className="text-muted">Page {page} of {list.pages}</span>
          {page < list.pages && <Link href={`/studio/transcriptions?status=${filter}&page=${page + 1}`} className="underline">Next</Link>}
        </nav>
      )}
    </div>
  );
}
