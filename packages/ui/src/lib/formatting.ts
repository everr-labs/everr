export function formatDuration(value: number, unit: "ms" | "s" | "ns" = "s"): string {
  const ms = unit === "ns" ? value / 1e6 : unit === "s" ? value * 1000 : value;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDurationCompact(value: number, unit: "ms" | "s" = "ms"): string {
  const ms = unit === "s" ? value * 1000 : value;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
