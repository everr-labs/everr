import { cn } from "@everr/ui/lib/utils";

// The height of the drawing in its own units. The list and the page header
// both show it 20px high, so one unit is one pixel there.
const HEIGHT = 20;
// The gap between two cells, as a share of a cell's width.
const GAP = 0.2;
// The faintest shade a bucket with occurrences gets, so that a single
// occurrence never reads as an empty bucket.
const MIN_OPACITY = 0.3;

/** The busiest bucket across several trends, to draw them on one scale. */
export function errorTrendPeak(trends: number[][]): number {
  return trends.reduce((max, buckets) => Math.max(max, ...buckets), 0);
}

/**
 * Occurrences over the queried range as a strip of cells, one per bucket,
 * oldest first. Every cell has the same size, so the cells of a list line up
 * in columns and a time window reads down the list. A busier bucket is a
 * stronger shade, on a log scale up to `scaleMax`: pass the same value to
 * every row of a list so the shades compare across rows. Without it the strip
 * uses its own busiest bucket. The exact count is in the Occurrences column.
 */
export function ErrorTrend({
  buckets,
  scaleMax,
  className,
}: {
  buckets: number[];
  scaleMax?: number;
  className?: string;
}) {
  const own = Math.max(0, ...buckets);
  if (own === 0) return <div aria-hidden="true" className={className} />;
  const peak = Math.max(scaleMax ?? 0, own);

  return (
    <svg
      viewBox={`0 0 ${buckets.length} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-label={`Occurrences over the time range. The busiest interval has ${own.toLocaleString()}.`}
      className={cn("overflow-visible", className)}
    >
      <title>Occurrences over the time range</title>
      {buckets.map((count, index) => (
        <rect
          // oxlint-disable-next-line react/no-array-index-key -- A bucket is its position in the time range; the list has a fixed length and order.
          key={index}
          x={index + GAP / 2}
          y={0}
          width={1 - GAP}
          height={HEIGHT}
          className={count > 0 ? "fill-ctp-lavender" : "fill-muted"}
          fillOpacity={count > 0 ? shade(count, peak) : undefined}
        />
      ))}
    </svg>
  );
}

function shade(count: number, peak: number): number {
  if (peak <= 1) return 1;
  const t = Math.log1p(count) / Math.log1p(peak);
  return MIN_OPACITY + (1 - MIN_OPACITY) * t;
}
