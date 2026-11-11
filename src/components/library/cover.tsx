import { coverColor } from "@/lib/subjects";
import { cn } from "@/lib/utils";

/**
 * A course's cover. The book's own first page when there is one; otherwise a
 * cover from the series: the subject's colour, a darker spine, a pink band,
 * and the title set on it (left out at small sizes, where it can't be read).
 */
export function CourseCover({ title, coverUrl, subject, small = false }: { title: string; coverUrl?: string | null; subject?: string | null; small?: boolean }) {
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- private, auth-protected image; next/image can't optimise it
    return <img src={coverUrl} alt="" className="aspect-[3/4] w-full rounded-md border border-border bg-white object-cover object-top" loading="lazy" />;
  }
  return (
    <div
      aria-hidden
      className={cn("hero-card flex aspect-[3/4] w-full items-end rounded-md", small ? "[--band:0.25rem] [--spine:0.35rem]" : "pb-[14%] pl-[16%] pr-[8%] [--band:6%] [--spine:9%] @container")}
      style={{ ["--cover" as string]: coverColor(subject) }}
    >
      {!small && <span className="cover-title line-clamp-5 hyphens-auto text-[clamp(0.55rem,10cqw,1.4rem)] [overflow-wrap:break-word]" lang="en">{title}</span>}
    </div>
  );
}
