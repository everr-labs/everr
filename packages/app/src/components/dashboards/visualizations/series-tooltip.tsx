import { Fragment, type ReactNode } from "react";

export interface SeriesTooltipRow {
  key: string;
  color?: string;
  label: ReactNode;
  value: string;
}

/**
 * The shared tooltip content for chart visualizations: a title (timestamp or
 * category) over a swatch · label · value grid. Chrome-free so it can sit
 * inside `CursorTooltip` (which supplies the card and positioning) — shared by
 * the time-series, bar, and other chart visualizations.
 */
export function SeriesTooltipContent({
  title,
  rows,
}: {
  /** Omitted entirely when nullish — e.g. an ungrouped treemap tile. */
  title?: ReactNode;
  rows: SeriesTooltipRow[];
}) {
  return (
    <>
      {title != null && <div className="mb-1 text-muted-foreground">{title}</div>}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium tabular-nums">{row.value}</span>
          </Fragment>
        ))}
      </div>
    </>
  );
}
