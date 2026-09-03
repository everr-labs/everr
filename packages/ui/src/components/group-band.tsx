import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const TONE = {
  neutral: { wash: "bg-muted/20", icon: "text-muted-foreground" },
  warning: { wash: "bg-chart-2/8", icon: "text-chart-2" },
  danger: { wash: "bg-destructive/8", icon: "text-destructive" },
} as const;

export type GroupBandTone = keyof typeof TONE;

/**
 * A group of rows under the band that names and counts it.
 *
 * The band sticks inside its own opaque layer for exactly as long as the
 * group's rows are on screen, and the next group's band takes over rather
 * than piling on top. That is why the band and its rows are one element:
 * the sticky context is the group. Borders belong to the parent (`divide-y`),
 * never to the band, because a rule drawn on the band would ride with it
 * while it is stuck.
 *
 * Colour lands on the wash and the icon, never on the words, so lists with
 * and without tones read in one typeface. `h-9` with or without an action,
 * so bands on one page stand the same height.
 */
export function GroupBand({
  id,
  label,
  count,
  hint,
  icon: Icon,
  tone = "neutral",
  action,
  children,
}: {
  /** For the rows' `aria-labelledby`. */
  id?: string;
  label: string;
  /** A string where the count is a floor ("200+") rather than a total. */
  count?: number | string;
  /** Only for what the reader cannot see from the rows. */
  hint?: string;
  icon?: LucideIcon;
  tone?: GroupBandTone;
  /** A control at the band's right end. */
  action?: ReactNode;
  /** The group's rows, or what stands in for them. */
  children?: ReactNode;
}) {
  return (
    <section>
      <div className="sticky top-0 z-10 bg-background">
        {/* `px-3` on the same edge the rows use, so bands and rows all start
            on one left edge. */}
        <div
          className={cn(
            "flex h-9 items-center justify-between gap-3 px-3",
            TONE[tone].wash,
          )}
        >
          <h2 id={id} className="flex items-center gap-2">
            {Icon && (
              <Icon
                aria-hidden
                className={cn("size-3 shrink-0", TONE[tone].icon)}
              />
            )}
            <span className={kickerClass}>{label}</span>
            {count != null && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
            {hint && (
              <span className="text-xs text-muted-foreground">{hint}</span>
            )}
          </h2>
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}
