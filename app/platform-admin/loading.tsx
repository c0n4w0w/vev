export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Laster …</span>
      <div className="mb-8 border-b border-line pb-6">
        <div className="h-3 w-40 animate-pulse rounded bg-paper-2" />
        <div className="mt-3 h-8 w-64 animate-pulse rounded bg-paper-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-[6px] border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-10 h-64 animate-pulse rounded-[6px] border border-line bg-surface" />
    </div>
  );
}
