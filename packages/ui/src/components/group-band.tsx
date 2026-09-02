import { cn } from "@everr/ui/lib/utils";
import type { ComponentType, ReactNode, SVGProps } from "react";

/**
 * The small mono uppercase label that heads a group of rows or a column of
 * them. One token, so a list's bands and its column strip read as one frame
 * rather than two sizes of the same idea.
 */
export const kickerClass =
  "font-mono text-[0.6875rem] tracking-wider text-muted-foreground uppercase";

const TONE = {
  neutral: { wash: "bg-muted/20", icon: "text-muted-foreground" },
  warning: { wash: "bg-chart-2/8", icon: "text-chart-2" },
  danger: { wash: "bg-destructive/8", icon: "text-destructive" },
} as const;

export type GroupBandTone = keyof typeof TONE;

/**
 * The band that names a group of rows and counts it.
 *
 * Sticky, inside its own opaque layer: the wash is translucent, and
 * translucent over scrolling rows smears them. The caller wraps each band
 * with its rows, so a band stays on screen for exactly as long as its rows do
 * and the next one takes over rather than piling on top. Borders belong to
 * that wrapper too (`divide-y`), never to the band: a rule drawn on a band
 * rides with it while it is stuck.
 *
 * Colour lands on the wash and the icon, never on the words, so two lists
 * with and without tones still read in one typeface. `h-9` whether or not
 * there is an action, so bands on one page stand the same height.
 */
export function GroupBand({
  id,
  label,
  count,
  hint,
  icon: Icon,
  tone = "neutral",
  action,
  className,
}: {
  /** For the list's `aria-labelledby`. */
  id?: string;
  label: string;
  /** A string where the count is a floor ("200+") rather than a total. */
  count?: number | string;
  /** Only for what the reader cannot see from the rows. */
  hint?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: GroupBandTone;
  /** A control at the band's right end. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className="sticky top-0 z-10 bg-background">
      {/* `px-3` on the same edge the rows use, so bands and rows all start on
          one left edge. */}
      <div
        className={cn(
          "flex h-9 items-center justify-between gap-3 px-3",
          TONE[tone].wash,
          className,
        )}
      >
        <h2 id={id} className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon
              aria-hidden
              className={cn("size-3 shrink-0", TONE[tone].icon)}
            />
          )}
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={kickerClass}>{label}</span>
            {count != null && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
            {hint && (
              <span className="truncate text-xs text-muted-foreground">
                {hint}
              </span>
            )}
          </span>
        </h2>
        {action}
      </div>
    </div>
  );
}
