import { cn } from "@/lib/utils";
import { BookLoader } from "./book-loader";

/**
 * Placeholder shapes shown the instant you click a link, while the next page
 * is prepared on the server (each route's loading.tsx). A soft shimmer, not
 * a spinner, so the page feels like it's already arriving.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function PageSkeleton({
  variant = "page",
  label = "Loading…",
}: {
  variant?: "page" | "lesson" | "dashboard" | "narrow";
  label?: string;
}) {
  return (
    // One screen tall, so the book sits in the middle of what you can see; the
    // page's outline shimmers faintly behind it.
    <div
      aria-busy
      className="fade-in-soon relative h-[calc(100dvh-8rem)] min-h-80 overflow-hidden"
    >
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
        <div className="loader-halo flex flex-col items-center rounded-3xl px-10 py-8">
          <BookLoader label={label} size="lg" showLabel />
        </div>
      </div>
      <div
        aria-hidden
        className="opacity-50 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      >
        {variant === "dashboard" ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            <Skeleton className="h-9 w-72" />
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-56 rounded-xl" />
              <Skeleton className="h-56 rounded-xl" />
            </div>
          </div>
        ) : variant === "lesson" ? (
          <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="hidden flex-col gap-3 lg:flex">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
            <div className="flex max-w-3xl flex-col gap-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-8 w-80" />
              <Skeleton className="mt-4 h-5 w-full" />
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto flex flex-col gap-4",
              variant === "narrow" ? "max-w-2xl" : "max-w-3xl",
            )}
          >
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-10 w-full" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
