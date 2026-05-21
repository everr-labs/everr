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
    <div className="bg-muted h-1.5 w-32 overflow-hidden rounded">
      <div
        className="bg-primary h-full"
        style={{ width: `${Math.max(2, ratio * 100)}%` }}
      />
    </div>
  );
}
