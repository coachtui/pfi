"use client";

export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-full border border-border-subtle bg-inset p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`min-h-8 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors duration-200 ${
            value === o.key ? "bg-elevated-2 text-primary shadow-card" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
