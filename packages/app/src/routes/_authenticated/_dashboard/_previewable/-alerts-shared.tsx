import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { BellOff } from "lucide-react";
import { useEffect, useState } from "react";

// Re-exported here so this file's existing callers (this route tree's alerts
// list and alert detail pages) keep their current import path; the canonical
// definitions live in components/cc/shared.tsx, shared with the advanced
// alerting pages.
export { formatInterval, RelativeTime } from "@/components/cc/shared";

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

function formatTimeUntil(value: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.ceil(diffMs / 86_400_000)}d`;
}

function TimeUntil({ value }: { value: Date | string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return <span title={formatDate(value)}>{formatTimeUntil(value)}</span>;
}

// A rule is overdue if it has not evaluated in well over its interval — a sign
// the scanner is stuck or the rule errored. Allow three intervals plus a minute
// of scheduling slack before flagging it.
export function isEvaluationStale(
  lastEvaluatedAt: Date | string | null,
  evaluationIntervalSeconds: number,
): boolean {
  if (!lastEvaluatedAt) return false;
  const last =
    typeof lastEvaluatedAt === "string"
      ? new Date(lastEvaluatedAt)
      : lastEvaluatedAt;
  if (Number.isNaN(last.getTime())) return false;
  const overdueMs = (evaluationIntervalSeconds * 3 + 60) * 1000;
  return Date.now() - last.getTime() > overdueMs;
}

function stateVariant(state: "unknown" | "resolved" | "firing") {
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

// Shared duration idiom for mute dialogs: 1h/8h/24h presets plus a
// custom-hours fallback, with a live preview of the resulting end time. Used
// by both the rule-scoped mute dialog (alerts_.$alertId.tsx) and the
// standalone org-wide mute dialog (alerts.tsx).
const MUTE_DURATION_PRESETS = [
  { hours: "1", label: "1h" },
  { hours: "8", label: "8h" },
  { hours: "24", label: "24h" },
] as const;

// `hours` only ever holds a MUTE_DURATION_PRESETS value or a custom hour count.
export function muteEndFromHours(hours: string): Date {
  const n = Number(hours);
  return new Date(Date.now() + (Number.isFinite(n) ? n : 0) * 3_600_000);
}

export function isCustomHoursInvalid(
  duration: string,
  customHours: string,
): boolean {
  if (duration !== "custom") return false;
  const n = Number(customHours);
  return !Number.isFinite(n) || n <= 0;
}

export function MuteDurationFieldset({
  duration,
  onDurationChange,
  customHours,
  onCustomHoursChange,
}: {
  duration: string;
  onDurationChange: (hours: string) => void;
  customHours: string;
  onCustomHoursChange: (hours: string) => void;
}) {
  const effectiveHours = duration === "custom" ? customHours : duration;
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
      <legend className="p-0 text-xs/relaxed font-medium">Duration</legend>
      <div className="flex flex-wrap gap-1.5">
        {MUTE_DURATION_PRESETS.map((preset) => (
          <Button
            key={preset.hours}
            type="button"
            variant={duration === preset.hours ? "default" : "outline"}
            size="sm"
            aria-pressed={duration === preset.hours}
            onClick={() => onDurationChange(preset.hours)}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={duration === "custom" ? "default" : "outline"}
          size="sm"
          aria-pressed={duration === "custom"}
          onClick={() => onDurationChange("custom")}
        >
          Custom
        </Button>
      </div>
      {duration === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            aria-label="Custom duration in hours"
            type="number"
            min={1}
            className="w-20 tabular-nums"
            value={customHours}
            onChange={(event) => onCustomHoursChange(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">hours</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Muted until {formatDate(muteEndFromHours(effectiveHours))}
      </p>
    </fieldset>
  );
}

export function AlertStateBadges({
  state,
  active,
  firingInstanceCount,
  activeSilenceCount,
  activeSilenceExpiresAt,
}: {
  state: "unknown" | "resolved" | "firing";
  active: boolean;
  firingInstanceCount: number;
  activeSilenceCount: number;
  activeSilenceExpiresAt: Date | string | null;
}) {
  const silenceLabel = activeSilenceCount === 1 ? "mute" : "mutes";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={stateVariant(state)}>
        {state === "firing" && firingInstanceCount > 0
          ? `firing · ${firingInstanceCount}`
          : state}
      </Badge>
      {!active && <Badge variant="outline">inactive</Badge>}
      {activeSilenceCount > 0 && (
        <Badge
          variant="outline"
          className="border-muted-foreground/20 bg-muted/30 text-muted-foreground"
          title={`${activeSilenceCount} active ${silenceLabel}`}
        >
          <BellOff data-icon="inline-start" />
          {`muted${activeSilenceCount > 1 ? ` · ${activeSilenceCount}` : ""}`}
          {activeSilenceExpiresAt && (
            <>
              {" · expires "}
              <TimeUntil value={activeSilenceExpiresAt} />
            </>
          )}
        </Badge>
      )}
    </div>
  );
}
