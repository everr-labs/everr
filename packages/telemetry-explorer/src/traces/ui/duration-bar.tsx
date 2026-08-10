type DurationBarProps = {
  durationNs: bigint;
  maxDurationNs: bigint;
};

export function DurationBar({ durationNs, maxDurationNs }: DurationBarProps) {
  const ratio =
    maxDurationNs === 0n
      ? 0
      : Number((durationNs * 1000n) / maxDurationNs) / 1000;
  return (
    // The bar takes the width of the column that holds it. A fixed width here
    // makes the bar wider than a narrower column, and the bar then covers part
    // of the next column.
    <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
      <div
        className="bg-primary h-full"
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
      />
    </div>
  );
}
