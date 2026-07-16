export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading accounts" className="flex flex-col gap-3">
      <div className="h-7 w-36 animate-pulse rounded-lg bg-elevated" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-card bg-elevated" />
      ))}
    </div>
  );
}
