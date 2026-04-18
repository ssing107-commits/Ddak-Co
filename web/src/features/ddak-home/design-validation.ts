import type { DesignDoc } from "./types";

export function isDesignPayload(data: unknown): data is DesignDoc {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const o = data as Record<string, unknown>;
  if (typeof o.appName !== "string") return false;
  if (
    !Array.isArray(o.coreFeatures) ||
    !o.coreFeatures.every((f) => typeof f === "string")
  ) {
    return false;
  }
  if (
    !Array.isArray(o.pages) ||
    !o.pages.every(
      (p) =>
        p &&
        typeof p === "object" &&
        typeof (p as { name?: unknown }).name === "string" &&
        typeof (p as { purpose?: unknown }).purpose === "string"
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(o.dataStructure) ||
    !o.dataStructure.every(
      (d) =>
        d &&
        typeof d === "object" &&
        typeof (d as { entity?: unknown }).entity === "string" &&
        Array.isArray((d as { fields?: unknown[] }).fields)
    )
  ) {
    return false;
  }
  return true;
}
