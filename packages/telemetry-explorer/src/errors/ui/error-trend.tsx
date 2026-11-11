import { cn } from "@everr/ui/lib/utils";

// The height of the drawing in its own units. The list and the page header
// both show it 20px high, so one unit is one pixel there.
const HEIGHT = 20;
const MIN_BAR_HEIGHT = 3;

/**
 * Occurrences over the queried range as one bar for each bucket, oldest first.
 * The tallest bar is the busiest bucket of this Error, so the bars show when
 * the Error occurred and not how often: the Occurrences count gives that.
 */
export function ErrorTrend({ buckets, className }: { buckets: number[]; className?: string }) {
  const peak = buckets.reduce((max, count) => Math.max(max, count), 0);
  if (peak === 0) return <div aria-hidden="true" className={className} />;

  return (
    <svg
      viewBox={`0 0 ${buckets.length} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-label={`Occurrences over the time range. The busiest interval has ${peak.toLocaleString()}.`}
      className={cn("overflow-visible", className)}
    >
      <title>Occurrences over the time range</title>
      {buckets.map((count, index) => {
        // An empty bucket keeps a line on the baseline, so that a gap in the
        // Error reads as a gap and not as missing data.
        const height = count > 0 ? Math.max(MIN_BAR_HEIGHT, (count / peak) * HEIGHT) : 1;
        return (
          <rect
            // oxlint-disable-next-line react/no-array-index-key -- A bucket is its position in the time range; the list has a fixed length and order.
            key={index}
            x={index + 0.1}
            y={HEIGHT - height}
            width={0.8}
            height={height}
            className={count > 0 ? "fill-muted-foreground" : "fill-border"}
          />
        );
      })}
    </svg>
  );
}
