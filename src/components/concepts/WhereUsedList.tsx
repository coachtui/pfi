/** Compact surface list for "Where it appears" / "Where you'll see this in PFI". */
export function WhereUsedList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 pl-4">
      {items.map((item) => (
        <li key={item} className="list-disc text-sm text-secondary">
          {item}
        </li>
      ))}
    </ul>
  );
}
