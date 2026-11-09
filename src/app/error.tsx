"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted">Sorry, that didn&apos;t work. Your data is safe. Please try again.</p>
      <button type="button" onClick={reset} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-text">
        Try again
      </button>
    </main>
  );
}
