export function formatDuration(
  value: number,
  unit: "ms" | "s" | "ns" = "s",
): string {
  const ms = unit === "ns" ? value / 1e6 : unit === "s" ? value * 1000 : value;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatDurationCompact(
  value: number,
  unit: "ms" | "s" = "ms",
): string {
  const ms = unit === "s" ? value * 1000 : value;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function getSuccessRateVariant(
  rate: number,
  thresholds: { good: number; fair: number } = { good: 80, fair: 50 },
): "default" | "secondary" | "destructive" {
  if (rate >= thresholds.good) return "default";
  if (rate >= thresholds.fair) return "secondary";
  return "destructive";
}

export function getFailureRateColor(rate: number): string {
  if (rate >= 50) return "text-red-600";
  if (rate >= 20) return "text-orange-500";
  return "text-yellow-600";
}

export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Plain number → treat as milliseconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Parse segments: "1m30s", "200ms", "1.5s", "2m", etc.
  let totalMs = 0;
  let matched = false;
  const regex = /(\d+(?:\.\d+)?)\s*(ms|s|m)/gi;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: Ok here
  while ((match = regex.exec(trimmed)) !== null) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "ms") totalMs += value;
    else if (unit === "s") totalMs += value * 1000;
    else if (unit === "m") totalMs += value * 60000;
  }

  return matched ? totalMs : null;
}

export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
