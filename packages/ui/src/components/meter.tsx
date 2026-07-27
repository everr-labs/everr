// A horizontal meter: a rounded track with one or more fills painted over it.
//
// The single primitive behind every "how full / how close to the line" bar —
// error budgets, burn against a firing threshold, quota. Tone, height and width
// are variants rather than per-caller class strings, so the health vocabulary
// (emerald healthy, amber attention, red emergency) is declared once.
//
// Purely decorative: it is `aria-hidden`, and every caller prints the figure it
// encodes next to it, which is the accessible value.

import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

// Always full width: how wide a meter should be is the container's decision,
// not the meter's, so no call site has to fight a cap it did not ask for.
const meterTrack = cva("relative block w-full overflow-hidden rounded-full", {
  variants: {
    tone: {
      neutral: "bg-muted",
      warning: "bg-amber-500/15",
      danger: "bg-destructive/25",
    },
    size: { sm: "h-1", md: "h-1.5" },
  },
  defaultVariants: { tone: "neutral", size: "md" },
});

const meterFill = cva(
  "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]",
  {
    variants: {
      tone: {
        healthy: "bg-emerald-500",
        warning: "bg-amber-500",
        danger: "bg-destructive",
        /** A trailing/other value behind the headline one. */
        ghost: "bg-muted-foreground/30",
        /** A share of a total, where no health reading is implied. */
        chart: "bg-[var(--chart-1)]",
      },
    },
    defaultVariants: { tone: "healthy" },
  },
);

export type MeterFillTone = NonNullable<VariantProps<typeof meterFill>["tone"]>;

export type MeterLayer = {
  /** 0..100. Values at or below zero are not painted. */
  pct: number;
  tone: MeterFillTone;
};

export function Meter({
  layers,
  tone,
  size,
  className,
}: {
  /** Painted in order, so a later layer sits over an earlier one. */
  layers: MeterLayer[];
  className?: string;
} & VariantProps<typeof meterTrack>) {
  return (
    <span aria-hidden className={cn(meterTrack({ tone, size }), className)}>
      {layers.map(
        (layer, i) =>
          layer.pct > 0 && (
            <span
              // A fixed, ordered stack per call site; never reordered.
              key={i}
              className={meterFill({ tone: layer.tone })}
              style={{ width: `${Math.min(100, layer.pct)}%` }}
            />
          ),
      )}
    </span>
  );
}
