// packages/app/src/components/cc/budget-bar.tsx
//
// The error budget as a depleting meter — the one visual that makes an SLO
// legible at a glance. Fill = budget remaining; tone follows the shared health
// vocabulary (emerald, amber when running low, red when exhausted) and is
// always paired with the printed percentage so the state never rides on color
// alone (the Status-Plus-Shape rule).
import { cn } from "@everr/ui/lib/utils";

/** "99.95%" — SLI/budget fractions with enough precision to be honest. */
export function ccFmtFraction(f: number): string {
  return `${(f * 100).toFixed(2)}%`;
}

/** Burn rate multiple, the engine's own precision (fmt_burn: one decimal). */
export function ccFmtBurn(b: number): string {
  return `${b.toFixed(1)}×`;
}

// Below a quarter of budget left the meter turns amber: still inside the
// objective, but close enough that a sustained burn deserves attention.
const LOW_BUDGET = 0.25;

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
  const clamped = Math.max(0, Math.min(1, remaining));
  const exhausted = remaining <= 0;
  const low = !exhausted && remaining < LOW_BUDGET;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* The printed percentage below is the accessible value; the bar is a
          purely visual double-encoding of the same number. */}
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-24 shrink-0 overflow-hidden rounded-full",
          exhausted ? "bg-destructive/25" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
            exhausted
              ? "bg-destructive"
              : low
                ? "bg-amber-500"
                : "bg-emerald-500",
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums whitespace-nowrap",
          exhausted
            ? "font-medium text-destructive"
            : low
              ? "font-medium text-amber-600 dark:text-amber-400"
              : "text-foreground",
        )}
      >
        {/* A deeply-overspent budget prints as the state, not an absurd
            negative percentage ("-99900.00%" is noise, "exhausted" is the fact). */}
        {exhausted ? "exhausted" : ccFmtFraction(remaining)}
      </span>
    </span>
  );
}
