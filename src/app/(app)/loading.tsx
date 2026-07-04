/** Route-transition skeleton - mirrors the standard section layout (cards → table). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-8" aria-busy aria-label="Loading">
      <div className="space-y-2">
        <div className="skeleton h-9 w-64" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-36" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="skeleton h-72" />
    </div>
  );
}
