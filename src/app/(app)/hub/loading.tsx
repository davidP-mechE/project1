export default function Loading() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="mb-6 h-8 w-48 rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-32 sm:h-auto sm:aspect-[3/5] rounded-xl bg-surface-2" />)}
      </div>
      <span className="sr-only">Loading your library…</span>
    </div>
  );
}
