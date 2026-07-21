export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-label="Loading lesson" role="status">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-elevated" />
        <div className="h-4 w-72 rounded bg-elevated" />
      </div>
      <div className="h-9 rounded-full bg-elevated" />
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-elevated" />)}
    </div>
  );
}
