export function DeltaIndicator({
  current,
  previous,
  invertColors = false,
}: {
  current: number;
  previous: number;
  invertColors?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="text-green-600 text-xs font-normal">new</span>;

  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return null;

  const isPositive = delta > 0;
  // For duration, positive = bad (slower). For runs and success rate, positive = good.
  const isGood = invertColors ? !isPositive : isPositive;

  return (
    <span className={`text-xs font-normal ${isGood ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? "+" : ""}
      {Math.round(delta)}%
    </span>
  );
}
