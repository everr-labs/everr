import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";

export function AlertingSummaryLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function AlertingSummaryCard({
  ariaLabel,
  ariaLive,
  children,
}: {
  ariaLabel: string;
  ariaLive?: "off" | "polite" | "assertive";
  children: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} aria-live={ariaLive}>
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-lg bg-border ring-1 ring-foreground/10">
        {children}
      </dl>
    </section>
  );
}

export function AlertingBreachBreakdown({
  firing,
  pending,
}: {
  firing: number;
  pending: number;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span>
        <span className="font-medium text-destructive tabular-nums">
          {firing}
        </span>{" "}
        firing
      </span>
      <span>
        <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">
          {pending}
        </span>{" "}
        pending
      </span>
    </span>
  );
}

export function AlertingSummaryStat({
  label,
  value,
  detail,
  valueClassName,
  detailClassName,
  wrapValue = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  valueClassName?: string;
  detailClassName?: string;
  wrapValue?: boolean;
}) {
  return (
    <div className="min-w-40 flex-1 basis-40 bg-card px-3 py-2.5">
      <dt>
        <AlertingSummaryLabel>{label}</AlertingSummaryLabel>
      </dt>
      <dd className="mt-0.5 min-w-0">
        <div
          className={cn(
            "min-h-5 text-base font-semibold tabular-nums",
            wrapValue ? "whitespace-normal" : "truncate",
            valueClassName,
          )}
        >
          {value}
        </div>
        {detail !== undefined && detail !== null && (
          <div
            className={cn(
              "mt-0.5 truncate text-xs text-muted-foreground",
              detailClassName,
            )}
          >
            {detail}
          </div>
        )}
      </dd>
    </div>
  );
}
