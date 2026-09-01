export interface TimeSeriesLegendItem {
  key: string;
  label: string;
  color: string;
}

/**
 * Legend for the time-series panel: swatch · label, one entry per series.
 * uPlot ships its own legend, but it is a table with its own markup and
 * typography; this one matches the legends the other visualizations render.
 */
export function TimeSeriesLegend({ items }: { items: TimeSeriesLegendItem[] }) {
  return (
    <div className="flex max-h-24 shrink-0 flex-wrap justify-center gap-x-4 gap-y-1 overflow-y-auto px-2 pt-2 text-xs">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="truncate text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
