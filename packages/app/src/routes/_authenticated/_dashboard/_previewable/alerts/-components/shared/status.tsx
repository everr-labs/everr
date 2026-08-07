import { type Tone, toneDot, toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { HeartCrack } from "lucide-react";
import type { ReactNode } from "react";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingFmtWindowLabel,
} from "@/data/alerting/slos/model";
import type {
  AlertingRuleHealthStatus,
  AlertingSloTier,
} from "@/data/alerting/types";

export function AlertingStatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping",
            toneDot({ tone }),
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          toneDot({ tone }),
        )}
      />
    </span>
  );
}

export function AlertingStatusLabel({
  tone,
  pulse,
  muted,
  className,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        toneText({ tone: muted ? "muted" : tone }),
        className,
      )}
    >
      <AlertingStatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}

export function AlertingSeverityBadge({ severity }: { severity: string }) {
  const tone: Tone =
    severity === "critical"
      ? "danger"
      : severity === "warning"
        ? "warning"
        : severity === "info"
          ? "info"
          : "muted";
  return <AlertingStatusLabel tone={tone}>{severity}</AlertingStatusLabel>;
}

export function AlertingAlertStatusLabel({ status }: { status: string }) {
  const firing = status === "firing";
  const pending = status === "pending";
  const tone: Tone = firing ? "danger" : pending ? "warning" : "muted";
  return (
    <AlertingStatusLabel tone={tone} pulse={firing} muted={pending}>
      {status}
    </AlertingStatusLabel>
  );
}

export function AlertingSloTierBadge({
  tier,
  severity,
  tiers = ALERTING_CANONICAL_SLO_TIERS,
}: {
  tier: string;
  severity: string;
  tiers?: readonly AlertingSloTier[];
}) {
  const tone: Tone =
    severity === "critical"
      ? "danger"
      : severity === "warning"
        ? "warning"
        : "muted";
  const spec = tiers.find((t) => t.name === tier);
  const consequence =
    severity === "critical"
      ? "Pages whoever the route resolves to."
      : "Opens a ticket rather than paging.";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="rounded-sm outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary"
          />
        }
      >
        <AlertingStatusLabel tone={tone}>
          <span className="font-mono text-[0.6875rem]">{tier}</span>
        </AlertingStatusLabel>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 space-y-1 text-xs">
        {spec ? (
          <p>
            Fires when the last {alertingFmtWindowLabel(spec.long_window)} and
            the last {alertingFmtWindowLabel(spec.short_window)} both burn error
            budget at {spec.burn_rate}&times; or faster.
          </p>
        ) : (
          <p>
            A burn-rate tier this SLO no longer defines, so its thresholds are
            unknown.
          </p>
        )}
        <p className="text-muted-foreground">{consequence}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function AlertingHealthHeart({
  status,
  className,
}: {
  status: AlertingRuleHealthStatus | undefined;
  className?: string;
}) {
  if (status !== "degraded") return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Evaluation degraded"
            className={cn(
              "inline-flex shrink-0 items-center rounded-sm outline-2 outline-dotted outline-transparent outline-offset-2 focus-visible:outline-primary",
              toneText({ tone: "danger" }),
              className,
            )}
          />
        }
      >
        <HeartCrack className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        The query is failing, so this is not being evaluated. Nothing new can
        fire and the numbers stop moving until it runs again.
      </TooltipContent>
    </Tooltip>
  );
}
