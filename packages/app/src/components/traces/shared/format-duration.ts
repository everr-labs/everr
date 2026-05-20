export function formatDurationNs(ns: bigint | string | number): string {
  const value = typeof ns === "bigint" ? ns : BigInt(ns);
  if (value < 1_000n) return `${value}ns`;
  if (value < 1_000_000n) {
    return `${(Number(value) / 1_000).toFixed(1)}μs`;
  }
  if (value < 1_000_000_000n) {
    return `${(Number(value) / 1_000_000).toFixed(2)}ms`;
  }
  const seconds = Number(value) / 1_000_000_000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.floor(seconds - mins * 60);
  return `${mins}m ${rem}s`;
}
