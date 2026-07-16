export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading transactions" className="flex flex-col gap-3">
      <div className="h-7 w-44 animate-pulse rounded-lg bg-elevated" />
      <div className="h-9 w-full animate-pulse rounded-full bg-elevated" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-card bg-elevated" />
      ))}
    </div>
  );
}
