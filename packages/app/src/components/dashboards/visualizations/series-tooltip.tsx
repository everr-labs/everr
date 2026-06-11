import { cn } from "@everr/ui/lib/utils";
import { Fragment, type ReactNode } from "react";

export interface SeriesTooltipRow {
  key: string;
  color?: string;
  label: ReactNode;
  value: string;
}

/**
 * The shared tooltip card for chart visualizations: a title (timestamp or
 * category) over a swatch · label · value grid. Purely presentational so it
 * works both portaled at the cursor (time-series chart) and as recharts
 * Tooltip content (bar chart) — positioning is the caller's concern.
 */
export function SeriesTooltipCard({
  title,
  rows,
  className,
  style,
}: {
  title: ReactNode;
  rows: SeriesTooltipRow[];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md",
        className,
      )}
      style={style}
    >
      <div className="mb-1 text-muted-foreground">{title}</div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {rows.map((row) => (
          <Fragment key={row.key}>
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="text-right font-medium tabular-nums">
              {row.value}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
