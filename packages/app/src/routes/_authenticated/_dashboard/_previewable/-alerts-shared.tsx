import { Badge } from "@everr/ui/components/badge";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { useEffect, useState } from "react";

// Centered load-failure message for a card or table body whose query errored.
export function QueryErrorMessage({ message }: { message: string }) {
  return (
    <p className="px-3 py-6 text-center text-destructive" role="alert">
      {message}
    </p>
  );
}

export function formatDate(value: Date | string | null) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatInterval(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// Re-renders every minute so the elapsed time keeps ticking without a refetch
// (formatRelativeTime's granularity is minutes/hours/days).
export function RelativeTime({ value }: { value: Date | string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const iso = value instanceof Date ? value.toISOString() : (value ?? "");
  return <span title={formatDate(value)}>{formatRelativeTime(iso)}</span>;
}

export function stateVariant(state: "unknown" | "resolved" | "firing") {
  if (state === "firing") return "destructive" as const;
  if (state === "resolved") return "secondary" as const;
  return "outline" as const;
}

export function SeverityBadge({
  severity,
}: {
  severity: "info" | "warning" | "critical";
}) {
  const variant =
    severity === "critical"
      ? ("destructive" as const)
      : severity === "warning"
        ? ("secondary" as const)
        : ("outline" as const);
  return <Badge variant={variant}>{severity}</Badge>;
}

export function AlertStateBadges({
  state,
  active,
  firingInstanceCount,
  silenced,
}: {
  state: "unknown" | "resolved" | "firing";
  active: boolean;
  firingInstanceCount: number;
  silenced: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={stateVariant(state)}>
        {state === "firing" && firingInstanceCount > 0
          ? `firing · ${firingInstanceCount}`
          : state}
      </Badge>
      {!active && <Badge variant="outline">inactive</Badge>}
      {silenced && <Badge variant="secondary">silenced</Badge>}
    </div>
  );
}
