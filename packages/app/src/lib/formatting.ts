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

/**
 * Detect the hierarchy separator used in a test name.
 * Vitest uses " > " (e.g., "pkg > Describe > test"),
 * Rust uses "::" (e.g., "module::suite::test"),
 * and Go uses "/" (e.g., "TestSuite/SubTest").
 */
export function testNameSeparator(name: string): string {
  if (name.includes(" > ")) return " > ";
  if (name.includes("::")) return "::";
  return "/";
}

/** Extract the last segment of a hierarchical test name for display. */
export function testNameLastSegment(name: string): string {
  return name.split(testNameSeparator(name)).pop() ?? name;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  const value = bytes / k ** i;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytesPerSecond) / Math.log(k)),
    units.length - 1,
  );
  const value = bytesPerSecond / k ** i;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatPercent(value: number): string {
  if (value >= 10) return `${Math.round(value)}%`;
  return `${value.toFixed(1)}%`;
}

export function formatTimeOfDay(unixMs: number): string {
  const d = new Date(unixMs);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function parseTimestampAsUTC(timestamp: string): Date | null {
  // ClickHouse often returns "YYYY-MM-DD HH:mm:ss[.sss]" without timezone.
  // Treat timezone-less timestamps as UTC to avoid client-local drift.
  const normalized = timestamp.trim();
  if (!normalized) {
    return null;
  }
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const candidate = hasTimezone
    ? normalized
    : `${normalized.includes("T") ? normalized : normalized.replace(" ", "T")}Z`;
  const parsed = new Date(candidate);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeTimestampToUtc(timestamp: string): string {
  const parsed = parseTimestampAsUTC(timestamp);
  return parsed ? parsed.toISOString() : timestamp;
}

export function formatTimestampTimeOfDay(timestamp: string): string {
  const parsed = parseTimestampAsUTC(timestamp);
  return parsed ? parsed.toLocaleTimeString() : "—";
}

export function formatRelativeTime(timestamp: string): string {
  const date = parseTimestampAsUTC(timestamp);
  if (!date) return "—";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
