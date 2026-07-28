import { cn } from "@everr/ui/lib/utils";
import { Fragment, type ReactNode } from "react";

export interface SeriesTooltipRow {
  key: string;
  color?: string;
  label: ReactNode;
  value: string;
  /**
   * The row the pointer is nearest. When any row sets this, the others recede,
   * which is what makes a multi-series tooltip usable where lines overlap: the
   * card still lists every series, but says which one you are pointing at.
   */
  active?: boolean;
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
  const anyActive = rows.some((r) => r.active);
  return (
    <>
      {title != null && (
        <div className="mb-1 text-muted-foreground">{title}</div>
      )}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
        {rows.map((row) => {
          // Only recede rows once something is actually singled out, so a
          // tooltip with no active row looks exactly as it always has.
          const dim = anyActive && !row.active;
          return (
            <Fragment key={row.key}>
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full",
                  dim && "opacity-40",
                )}
                style={{ backgroundColor: row.color }}
              />
              <span
                className={cn(
                  row.active
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                  dim && "opacity-60",
                )}
              >
                {row.label}
              </span>
              <span
                className={cn(
                  "text-right font-medium tabular-nums",
                  dim && "opacity-60",
                )}
              >
                {row.value}
              </span>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
