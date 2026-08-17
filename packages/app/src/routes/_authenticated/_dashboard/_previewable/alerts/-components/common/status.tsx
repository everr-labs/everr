import { type Tone, toneDot, toneText } from "@everr/ui/components/tone";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { cn } from "@everr/ui/lib/utils";
import { HeartCrack } from "lucide-react";
import type { ReactNode } from "react";
import type { AlertingRuleHealthStatus } from "@/data/alerting/types";

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

export function alertingSeverityTone(severity: string): Tone {
  return severity === "critical"
    ? "danger"
    : severity === "warning"
      ? "warning"
      : severity === "info"
        ? "info"
        : "muted";
}

export function AlertingSeverityBadge({ severity }: { severity: string }) {
  return (
    <AlertingStatusLabel tone={alertingSeverityTone(severity)}>
      {severity}
    </AlertingStatusLabel>
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
