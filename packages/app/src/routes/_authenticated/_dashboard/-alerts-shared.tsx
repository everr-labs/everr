import { Badge } from "@everr/ui/components/badge";

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

export function stateVariant(state: "unknown" | "resolved" | "firing") {
  if (state === "firing") return "destructive" as const;
  if (state === "resolved") return "secondary" as const;
  return "outline" as const;
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
