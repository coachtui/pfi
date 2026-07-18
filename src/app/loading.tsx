export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading dashboard" role="status">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-elevated" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-elevated" />
          <div className="h-3 w-20 rounded bg-elevated" />
        </div>
      </div>
      <div className="h-96 rounded-card bg-elevated" />
      <div className="grid grid-cols-4 gap-2 md:gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-card bg-elevated sm:h-28" />)}
      </div>
    </div>
  );
}
