function parseTimestampAsUTC(timestamp: string): Date | null {
  const normalized = timestamp.trim();
  if (!normalized) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const candidate = hasTimezone
    ? normalized
    : `${normalized.includes("T") ? normalized : normalized.replace(" ", "T")}Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
