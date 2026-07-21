export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading Academy" role="status">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-36 rounded bg-elevated" />
        <div className="h-4 w-56 rounded bg-elevated" />
      </div>
      <div className="h-24 rounded-card bg-elevated" />
      <div className="h-28 rounded-card bg-elevated" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 w-64 rounded bg-elevated" />
          {[0, 1, 2].map((j) => <div key={j} className="h-16 rounded-xl bg-elevated" />)}
        </div>
      ))}
    </div>
  );
}
