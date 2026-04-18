import type { EditableFeature } from "@/components/feature-selection-cards";

export function buildEditableFeatures(features: string[]): EditableFeature[] {
  const stamp = Date.now().toString(36);
  return features.map((feature, i) => ({
    id: `${stamp}-${i}`,
    text: feature,
    checked: true,
  }));
}

export function pickSelectedFeatures(features: EditableFeature[]): string[] {
  return features
    .filter((f) => f.checked)
    .map((f) => f.text.trim())
    .filter(Boolean);
}
