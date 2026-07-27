// packages/app/src/components/cc/budget-bar.tsx
//
// The error budget as a depleting meter — the one visual that makes an SLO
// legible at a glance. Fill = budget remaining; tone follows the shared health
// vocabulary (emerald, amber when running low, red when exhausted) and is
// always paired with the printed percentage so the state never rides on color
// alone (the Status-Plus-Shape rule).
import { Meter, type MeterFillTone } from "@everr/ui/components/meter";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";

/** "99.95%" — SLI/budget fractions with enough precision to be honest. */
export function ccFmtFraction(f: number): string {
  return `${(f * 100).toFixed(2)}%`;
}

/** Burn rate multiple, the engine's own precision (fmt_burn: one decimal). */
export function ccFmtBurn(b: number): string {
  return `${b.toFixed(1)}×`;
}

/**
 * Budget remaining as a number, always — never a state word, so an overspend
 * says how far past the line it is. Precision recedes as magnitude grows, which
 * is what keeps that readable: -99900.00% becomes "-99.9k%". Non-negative values
 * are untouched.
 */
export function ccFmtBudgetRemaining(remaining: number): string {
  if (remaining >= 0) return ccFmtFraction(remaining);
  const pct = remaining * 100;
  const magnitude = -pct;
  if (magnitude >= 1000) return `-${(magnitude / 1000).toFixed(1)}k%`;
  if (magnitude >= 100) return `${pct.toFixed(0)}%`;
  return ccFmtFraction(remaining);
}

// Below a quarter of budget left the meter turns amber: still inside the
// objective, but close enough that a sustained burn deserves attention.
const LOW_BUDGET = 0.25;

/**
 * The budget health band for a remaining fraction: `exhausted` (<= 0), `low`
 * (< 25% left), or neither. The single source of both thresholds, so the bar,
 * the figure's colour and the detail hero always turn amber and red together.
 */
function ccBudgetTone(remaining: number | null): {
  exhausted: boolean;
  low: boolean;
} {
  if (remaining === null) return { exhausted: false, low: false };
  const exhausted = remaining <= 0;
  return { exhausted, low: !exhausted && remaining < LOW_BUDGET };
}

/**
 * The colour a budget figure takes at this level, so no caller has to re-derive
 * it (the detail hero used to pick it by string-comparing a CSS class).
 * Undefined at a healthy budget: inherit whatever the surface already sets.
 */
export function ccBudgetTextTone(remaining: number | null): string | undefined {
  const { exhausted, low } = ccBudgetTone(remaining);
  if (!exhausted && !low) return undefined;
  return toneText({ tone: exhausted ? "danger" : "warning" });
}

/** The budget's health band as the shared meter/text tone vocabulary. */
function budgetToneName(remaining: number | null): MeterFillTone {
  const { exhausted, low } = ccBudgetTone(remaining);
  return exhausted ? "danger" : low ? "warning" : "healthy";
}

/** The depleting meter on its own, sized by the caller via `className`. */
export function CcBudgetMeter({
  remaining,
  className,
  ...variants
}: {
  remaining: number | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Meter>, "layers">) {
  const { exhausted } = ccBudgetTone(remaining);
  return (
    <Meter
      {...variants}
      className={className}
      tone={exhausted ? "danger" : "neutral"}
      layers={[
        {
          pct:
            remaining === null ? 0 : Math.max(0, Math.min(1, remaining)) * 100,
          tone: budgetToneName(remaining),
        },
      ]}
    />
  );
}

export function CcBudgetBar({
  remaining,
  className,
}: {
  /** Budget remaining as a 0..1 fraction (may go negative); null = unknown. */
  remaining: number | null;
  className?: string;
}) {
  if (remaining === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const tone = ccBudgetTextTone(remaining);
  return (
    <span className={cn("flex w-full flex-col items-start gap-1", className)}>
      {/* The printed figure is the accessible value; the meter under it is a
          purely visual double-encoding of the same number. */}
      <span
        className={cn(
          "font-mono text-xs tabular-nums whitespace-nowrap",
          tone === undefined ? "text-foreground" : `font-medium ${tone}`,
        )}
      >
        {ccFmtBudgetRemaining(remaining)}
      </span>
      {/* Thinner than the detail hero's: an inline row readout, not the page's
          headline figure. */}
      <CcBudgetMeter remaining={remaining} size="sm" />
    </span>
  );
}
