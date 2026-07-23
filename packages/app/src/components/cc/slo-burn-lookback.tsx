// packages/app/src/components/cc/slo-burn-lookback.tsx
//
// Burn rate by lookback window: every tier window (short and long alike) is
// "average burn over the last X", so plotting them on one axis — longest span
// on the left, shortest on the right — turns the short-vs-long window concept
// into a readable shape. High on the right = spending budget right now; high
// only on the left = an older burst still inside the window, current traffic
// clean (the exact shape behind "ticket firing but recovering"). One series,
// one axis; the 1× sustainable line is the only reference. Values are printed
// at every point, so the chart never rides on color or hover alone.
import { cn } from "@everr/ui/lib/utils";
import { ccFmtBurn } from "@/components/cc/budget-bar";
import { type CcSloWindowBurn, ccFmtWindowLabel } from "@/data/cc/slo";

// Vertical geometry (px): value labels ride above the plot, window labels below.
const LABEL_BAND = 18;
const PLOT_HEIGHT = 72;
const AXIS_BAND = 30;

/** Horizontal inset (% of width) so end dots and labels don't clip. */
const X_INSET = 5;

export function SloBurnLookback({
  burns,
  className,
}: {
  /** ccSloWindowBurns output: longest window first. */
  burns: CcSloWindowBurn[];
  className?: string;
}) {
  const measured = burns.filter(
    (b): b is CcSloWindowBurn & { burn: number } => b.burn !== null,
  );
  if (measured.length === 0) return null;

  // Headroom above the peak so the top label fits; never below 1.6 so the 1×
  // line always sits visibly inside the plot instead of hugging an edge.
  const yMax = Math.max(1.6, ...measured.map((b) => b.burn * 1.25));
  const xPct = (i: number) =>
    burns.length === 1
      ? 50
      : X_INSET + (i / (burns.length - 1)) * (100 - 2 * X_INSET);
  const yPct = (v: number) => (1 - Math.max(0, v) / yMax) * 100;
  const sustainableY = yPct(1);

  // The connecting line skips unmeasured windows (a gap, not an invented 0).
  const linePoints = burns
    .map((b, i) => (b.burn === null ? null : `${xPct(i)},${yPct(b.burn)}`))
    .filter((p): p is string => p !== null)
    .join(" ");

  const summary = burns
    .map(
      (b) =>
        `last ${ccFmtWindowLabel(b.window)}: ${
          b.burn === null ? "no data" : ccFmtBurn(b.burn)
        }`,
    )
    .join(", ");

  return (
    <figure
      role="img"
      aria-label={`Average burn rate by lookback window — ${summary}. 1× spends the whole error budget exactly over the SLO window.`}
      className={cn("max-w-xl", className)}
    >
      <div
        className="relative"
        style={{ height: LABEL_BAND + PLOT_HEIGHT + AXIS_BAND }}
      >
        {/* Plot area */}
        <div
          className="absolute inset-x-0"
          style={{ top: LABEL_BAND, height: PLOT_HEIGHT }}
        >
          {/* 1× sustainable: the only reference line. Dashed = a threshold. */}
          <div
            aria-hidden
            className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
            style={{ top: `${sustainableY}%` }}
          />
          <span
            aria-hidden
            className="absolute right-0 -translate-y-full pb-0.5 text-[0.625rem] leading-none text-muted-foreground/80"
            style={{ top: `${sustainableY}%` }}
          >
            1× sustainable
          </span>
          {/* Baseline (0×) */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 border-b border-border/60"
          />
          {/* Connecting line */}
          {measured.length > 1 && (
            <svg
              role="presentation"
              aria-hidden
              className="absolute inset-0 size-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polyline
                points={linePoints}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="text-foreground/45"
              />
            </svg>
          )}
          {/* Dots + printed values (the accessible reading; hover adds nothing
              the labels don't already say). */}
          {burns.map((b, i) => {
            const left = `${xPct(i)}%`;
            if (b.burn === null) {
              return (
                <span
                  key={b.secs}
                  aria-hidden
                  className="absolute bottom-0 -translate-x-1/2 translate-y-1/2 text-[0.625rem] leading-none text-muted-foreground/50"
                  style={{ left }}
                >
                  no data
                </span>
              );
            }
            const over = b.burn >= 1;
            return (
              <span key={b.secs} aria-hidden>
                <span
                  className={cn(
                    "absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
                    over ? "bg-amber-500" : "bg-foreground/60",
                  )}
                  style={{ left, top: `${yPct(b.burn)}%` }}
                />
                <span
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-full pb-1.5 font-mono text-[0.6875rem] leading-none font-medium tabular-nums",
                    over
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                  )}
                  style={{ left, top: `${yPct(b.burn)}%` }}
                >
                  {ccFmtBurn(b.burn)}
                </span>
              </span>
            );
          })}
        </div>
        {/* Lookback axis: each tick is "the last X", oldest reach on the left. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0"
          style={{ height: AXIS_BAND }}
        >
          {burns.map((b, i) => (
            <span
              key={b.secs}
              className="absolute top-1.5 -translate-x-1/2 font-mono text-[0.625rem] leading-none whitespace-nowrap text-muted-foreground"
              style={{ left: `${xPct(i)}%` }}
            >
              last {ccFmtWindowLabel(b.window)}
            </span>
          ))}
          <span className="absolute top-5 left-0 text-[0.625rem] leading-none text-muted-foreground/60">
            further back
          </span>
          <span className="absolute top-5 right-0 text-[0.625rem] leading-none text-muted-foreground/60">
            right now
          </span>
        </div>
      </div>
    </figure>
  );
}
