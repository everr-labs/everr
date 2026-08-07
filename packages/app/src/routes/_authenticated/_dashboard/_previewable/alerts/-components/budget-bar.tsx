import { Meter } from "@everr/ui/components/meter";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { AlertingSummaryLabel } from "./summary-card";

export function alertingFmtFraction(f: number): string {
  return `${(f * 100).toFixed(2)}%`;
}

/** Burn-rate multiple at one-decimal precision. */
export function alertingFmtBurn(b: number): string {
  return `${b.toFixed(1)}×`;
}

/**
 * Always a number, never a state word, so an overspend says how far past.
 * Precision recedes as magnitude grows: -99900.00% renders "-99.9k%".
 */
export function alertingFmtBudgetRemaining(remaining: number): string {
  if (remaining >= 0) return alertingFmtFraction(remaining);
  const pct = remaining * 100;
  const magnitude = -pct;
  if (magnitude >= 1000) return `-${(magnitude / 1000).toFixed(1)}k%`;
  if (magnitude >= 100) return `${pct.toFixed(0)}%`;
  return alertingFmtFraction(remaining);
}

// Below this fraction remaining, the meter turns amber.
const LOW_BUDGET = 0.25;

/**
 * Single source of both thresholds, so every surface turns amber and red
 * together. Unknown budgets read healthy.
 */
function budgetTone(
  remaining: number | null,
): "danger" | "warning" | "healthy" {
  if (remaining === null || remaining >= LOW_BUDGET) return "healthy";
  return remaining <= 0 ? "danger" : "warning";
}

/** Undefined at a healthy budget: inherit whatever the surface already sets. */
export function alertingBudgetTextTone(
  remaining: number | null,
): string | undefined {
  const tone = budgetTone(remaining);
  return tone === "healthy" ? undefined : toneText({ tone });
}

export function AlertingBudgetMeter({
  remaining,
  className,
  ...variants
}: {
  remaining: number | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Meter>, "layers">) {
  const tone = budgetTone(remaining);
  return (
    <Meter
      {...variants}
      className={className}
      // An empty track reads as the state when there is no fill left to colour.
      tone={tone === "danger" ? "danger" : "neutral"}
      layers={[
        {
          pct:
            remaining === null ? 0 : Math.max(0, Math.min(1, remaining)) * 100,
          tone,
        },
      ]}
    />
  );
}

export function AlertingBudgetBar({
  remaining,
  className,
  hang = false,
  summarizeExhausted = false,
}: {
  /** Budget remaining as a 0..1 fraction (may go negative); null = unknown. */
  remaining: number | null;
  className?: string;
  /**
   * md+ only: right-align and hang the meter below the caller's value line.
   * The negative margin must exactly cancel the sm meter (h-1) plus the
   * tightened gap; it lives here so a meter size change cannot silently knock
   * a caller's grid out of alignment.
   */
  hang?: boolean;
  /** Lead with the state while preserving the exact overspend in a tooltip. */
  summarizeExhausted?: boolean;
}) {
  if (remaining === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone = alertingBudgetTextTone(remaining);
  return (
    <span
      className={cn(
        "flex w-full flex-col items-start gap-1",
        hang && "md:-mb-1.5 md:items-end md:gap-0.5",
        className,
      )}
    >
      {/* The printed figure is the accessible value; the meter only
          double-encodes it visually. */}
      <span
        title={
          summarizeExhausted && remaining <= 0
            ? `${alertingFmtBudgetRemaining(remaining)} remaining`
            : undefined
        }
        className={cn(
          "font-mono text-xs tabular-nums whitespace-nowrap",
          tone === undefined ? "text-foreground" : `font-medium ${tone}`,
        )}
      >
        {summarizeExhausted && remaining <= 0
          ? "Exhausted"
          : alertingFmtBudgetRemaining(remaining)}
      </span>
      <AlertingBudgetMeter remaining={remaining} size="sm" />
    </span>
  );
}

export function AlertingBudgetFact({
  remaining,
  className,
}: {
  remaining: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex w-24 shrink-0 flex-col items-end whitespace-nowrap",
        className,
      )}
      title="Error budget remaining"
    >
      <AlertingSummaryLabel className="truncate">budget</AlertingSummaryLabel>
      <AlertingBudgetBar
        remaining={remaining}
        summarizeExhausted
        hang
        className="w-full items-end"
      />
    </span>
  );
}
