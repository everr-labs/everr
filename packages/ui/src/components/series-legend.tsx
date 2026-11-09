import { ScrollArea } from "@everr/ui/components/scroll-area";
import type { SeriesTooltipRow } from "@everr/ui/components/series-tooltip";
import { cn } from "@everr/ui/lib/utils";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export interface LegendSeries {
  /** Render key, unique within one model. */
  id: string;
  /** Stable across refreshes that reorder the series. */
  identity: string;
  label: string;
  color: string;
}

/**
 * Click-to-isolate legend state for a chart. Focus is tracked by identity so
 * the focused series stays focused when a refresh reorders the result, and
 * resolves to null once it is gone from the data. `gridBottom` clears the
 * x-axis labels plus the legend as it wraps.
 */
export function useSeriesLegend(series: readonly LegendSeries[], showLegend: boolean) {
  const [focused, setFocused] = useState<string | null>(null);
  const [legendHeight, setLegendHeight] = useState(0);
  const legendRef = useRef<HTMLElement>(null);
  const activeSeries = series.find(({ identity }) => identity === focused)?.id ?? null;
  const toggleSeries = useCallback(
    (identity: string) => setFocused((current) => (current === identity ? null : identity)),
    [],
  );
  const isOnLegend = useCallback(
    (target: EventTarget) => target instanceof Node && !!legendRef.current?.contains(target),
    [],
  );
  return {
    activeSeries,
    toggleSeries,
    isOnLegend,
    gridBottom: showLegend ? Math.max(58, legendHeight + 30) : 32,
    legend: { series, activeSeries, legendRef, onHeightChange: setLegendHeight },
  };
}

/** Tooltip rows for the series with a value in `row`, limited to the focused
 * series while one is isolated. */
export function seriesTooltipRows(
  series: readonly LegendSeries[],
  row: Record<string, unknown>,
  activeSeries: string | null,
  format: (value: number) => string,
  nearest?: ReadonlySet<string>,
): SeriesTooltipRow[] {
  return series.flatMap(({ id, label, color }) => {
    const value = row[id];
    if (typeof value !== "number" || (activeSeries !== null && id !== activeSeries)) return [];
    return [{ key: id, color, label, value: format(value), active: nearest?.has(id) }];
  });
}

/**
 * The legend overlaid along the chart's bottom edge. Reports its rendered
 * height so the chart can reserve room for it as it wraps or scrolls.
 */
export function SeriesLegend({
  series,
  activeSeries,
  onToggle,
  onHeightChange,
  legendRef,
}: {
  series: readonly LegendSeries[];
  activeSeries: string | null;
  onToggle: (identity: string) => void;
  onHeightChange: (height: number) => void;
  legendRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;
    const observer = new ResizeObserver(() => onHeightChange(legend.offsetHeight));
    observer.observe(legend);
    return () => observer.disconnect();
  }, [legendRef, onHeightChange]);

  return (
    <section
      ref={legendRef}
      className="pointer-events-auto absolute inset-x-0 bottom-0 text-xs text-foreground"
      aria-label="Series legend"
    >
      <ScrollArea
        orientation="horizontal"
        viewportProps={{ tabIndex: 0, "aria-label": "Series legend" }}
      >
        <div className="flex w-max min-w-full items-center justify-center gap-4 p-3">
          {series.map(({ id, identity, label, color }) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeSeries === id}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2",
                activeSeries !== null && activeSeries !== id && "opacity-40",
              )}
              onClick={() => onToggle(identity)}
            >
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
              {label}
            </button>
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
