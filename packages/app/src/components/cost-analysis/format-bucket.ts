import type { BucketGranularity } from "@/data/cost-analysis/schemas";

export function formatBucket(
  iso: string,
  granularity: BucketGranularity,
  variant: "axis" | "tooltip",
): string {
  const d = new Date(iso);
  if (granularity === "hour") {
    if (variant === "axis") {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        hour12: true,
        timeZone: "UTC",
      });
    }
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      hour12: true,
      timeZone: "UTC",
    });
  }
  if (variant === "axis") {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}
