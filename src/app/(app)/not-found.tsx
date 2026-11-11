import Link from "next/link";

/** Not found, or not yours to see (the server answers the same for both, so ids can't be probed). */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="font-display text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">It may have been deleted, or you may not have access to it. If someone sent you this link, ask them to check it.</p>
      <Link href="/dashboard" className="text-sm font-medium text-primary underline">
        Go to Today
      </Link>
    </div>
  );
}
