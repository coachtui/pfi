export function ImportStepper<T extends string>({
  steps,
  current,
  labels,
}: {
  steps: readonly T[];
  current: T;
  labels: Record<T, string>;
}) {
  const index = Math.max(0, steps.indexOf(current));
  return (
    <div className="mb-6 flex flex-col gap-2" aria-label="Import progress">
      <div className="flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-[3px] flex-1 rounded-full ${
              i < index ? "bg-positive-strong" : i === index ? "bg-positive" : "bg-border-subtle"
            }`}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-primary">{labels[current]}</span>
        <span className="font-mono text-xs text-tertiary">
          Step {index + 1} of {steps.length}
        </span>
      </div>
    </div>
  );
}
