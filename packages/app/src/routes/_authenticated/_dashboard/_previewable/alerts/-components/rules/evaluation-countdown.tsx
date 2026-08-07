import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { useEffect, useState } from "react";

export function formatEvaluationCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

export function EvaluationCountdown({
  nextEvaluationAt,
  paused,
}: {
  nextEvaluationAt: string | null;
  paused: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (paused) return <span>Next evaluation paused</span>;

  const target = nextEvaluationAt
    ? parseTimestampAsUTC(nextEvaluationAt)
    : null;
  if (!target) return <span>Awaiting next evaluation</span>;

  const remainingSeconds = (target.getTime() - now) / 1_000;
  return (
    <span suppressHydrationWarning>
      {remainingSeconds <= 0
        ? "Evaluation due"
        : `Next in ${formatEvaluationCountdown(remainingSeconds)}`}
    </span>
  );
}
