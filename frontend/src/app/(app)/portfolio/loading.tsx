export default function PortfolioLoading() {
  return (
    <div className="animate-pulse space-y-8">
      {/* Hero skeleton */}
      <div>
        <div className="bg-muted h-8 w-32 rounded" />
        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="bg-muted h-3 w-20 rounded" />
            <div className="bg-muted mt-2 h-10 w-56 rounded" />
          </div>
          <div className="mb-1">
            <div className="bg-muted h-3 w-12 rounded" />
            <div className="bg-muted mt-2 h-7 w-16 rounded" />
          </div>
        </div>
      </div>

      {/* Allocation skeleton */}
      <div>
        <div className="bg-muted mb-4 h-5 w-24 rounded" />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <div className="mb-1 flex justify-between">
                <div className="bg-muted h-4 w-32 rounded" />
                <div className="bg-muted h-4 w-20 rounded" />
              </div>
              <div className="bg-muted h-5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Platform grid skeleton */}
      <div>
        <div className="bg-muted mb-3 h-5 w-24 rounded" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="bg-muted h-3 w-16 rounded" />
              <div className="bg-muted mt-1 h-4 w-24 rounded" />
              <div className="bg-muted mt-2 h-6 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
