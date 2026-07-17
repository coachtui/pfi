export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading import" className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
      <div className="h-7 w-36 animate-pulse rounded-lg bg-elevated" />
      <div className="h-5 w-64 animate-pulse rounded-lg bg-elevated" />
      <div className="h-40 animate-pulse rounded-card bg-elevated" />
    </div>
  );
}
