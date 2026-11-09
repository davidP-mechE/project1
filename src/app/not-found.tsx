import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/" className="text-primary underline">Go home</Link>
    </main>
  );
}
