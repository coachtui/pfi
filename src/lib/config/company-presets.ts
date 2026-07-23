import { Anchor, Mountain, Sailboat, Shell, Ship, Sun, Sunrise, Waves, type LucideIcon } from "lucide-react";

/** A curated company emblem the user can pick. Persisted as `preset:<id>`. */
export interface CompanyPreset {
  id: string;
  label: string;
  Icon: LucideIcon;
}

/**
 * Island/ocean-themed emblems matching the demo companies. Deliberately
 * excludes a palm so it never duplicates the default emblem (TreePalm), which
 * is what `logo_path === null` renders.
 */
export const COMPANY_PRESETS: readonly CompanyPreset[] = [
  { id: "waves", label: "Waves", Icon: Waves },
  { id: "mountain", label: "Mountain", Icon: Mountain },
  { id: "anchor", label: "Anchor", Icon: Anchor },
  { id: "sun", label: "Sun", Icon: Sun },
  { id: "ship", label: "Ship", Icon: Ship },
  { id: "sailboat", label: "Sailboat", Icon: Sailboat },
  { id: "sunrise", label: "Sunrise", Icon: Sunrise },
  { id: "shell", label: "Shell", Icon: Shell },
];

const PRESET_BY_ID: Record<string, CompanyPreset> = Object.fromEntries(
  COMPANY_PRESETS.map((p) => [p.id, p]),
);

export function isKnownPresetId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESET_BY_ID, id);
}

export type Emblem = { kind: "preset"; preset: CompanyPreset } | { kind: "default" };

/**
 * Turn a stored `logo_path` into a render instruction. Unknown or malformed
 * values fall back to the default emblem rather than throwing, so a preset
 * removed in a later release degrades gracefully. The `upload:*` namespace is
 * reserved for the deferred custom-upload slice and resolves to default here.
 */
export function resolveEmblem(logoPath: string | null): Emblem {
  if (logoPath && logoPath.startsWith("preset:")) {
    const preset = PRESET_BY_ID[logoPath.slice("preset:".length)];
    if (preset) return { kind: "preset", preset };
  }
  return { kind: "default" };
}
