import { TreePalm } from "lucide-react";
import { resolveEmblem } from "@/lib/config/company-presets";

/**
 * The circular company emblem. Renders the chosen preset icon, or the default
 * TreePalm when logo_path is null/unknown. `md` (48px) is the header size; `sm`
 * (40px) is used inside the emblem picker.
 */
export function CompanyEmblem({ logoPath, size = "md" }: { logoPath: string | null; size?: "sm" | "md" }) {
  const emblem = resolveEmblem(logoPath);
  const Icon = emblem.kind === "preset" ? emblem.preset.Icon : TreePalm;
  const dims = size === "md" ? { box: "size-12", icon: 24 } : { box: "size-10", icon: 20 };
  return (
    <span
      aria-hidden
      className={`flex ${dims.box} shrink-0 items-center justify-center rounded-full border border-positive/50 text-positive`}
    >
      <Icon size={dims.icon} />
    </span>
  );
}
