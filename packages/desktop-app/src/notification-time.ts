export type NotificationTimeFormatOptions = {
  locale?: Intl.LocalesArgument;
  now?: Date;
  timeZone?: string;
};

export function parseNotificationTimestamp(timestamp: string): Date | null {
  const normalized = timestamp.trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const candidate = hasTimezone
    ? normalized
    : `${normalized.includes("T") ? normalized : normalized.replace(" ", "T")}Z`;
  const parsed = new Date(candidate);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getNotificationTimeParts(
  timestamp: string,
  options: NotificationTimeFormatOptions = {},
): { absolute: string; timeZoneName: string | null } {
  const parsed = parseNotificationTimestamp(timestamp);
  if (!parsed) {
    return {
      absolute: "—",
      timeZoneName: null,
    };
  }

  const formatter = new Intl.DateTimeFormat(options.locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: options.timeZone,
  });

  return {
    absolute: formatter.format(parsed),
    timeZoneName: null,
  };
}

export function formatNotificationAbsoluteTime(
  timestamp: string,
  options?: NotificationTimeFormatOptions,
): string {
  return getNotificationTimeParts(timestamp, options).absolute;
}

export function formatNotificationRelativeTime(
  timestamp: string,
  options: NotificationTimeFormatOptions = {},
): string {
  const parsed = parseNotificationTimestamp(timestamp);
  if (!parsed) {
    return "—";
  }

  const now = options.now ?? new Date();
  const diffMs = now.getTime() - parsed.getTime();
  if (diffMs < 0) {
    return "just now";
  }

  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
