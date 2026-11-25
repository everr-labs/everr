const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const NANOSECONDS_PER: Record<string, number> = {
  nanoseconds: 1,
  nanosecond: 1,
  ns: 1,
  microseconds: 1e3,
  microsecond: 1e3,
  us: 1e3,
  milliseconds: 1e6,
  millisecond: 1e6,
  ms: 1e6,
  seconds: 1e9,
  second: 1e9,
  s: 1e9,
};

const DURATION_STEPS: [limit: number, divisor: number, suffix: string][] = [
  [1e3, 1, "ns"],
  [1e6, 1e3, "µs"],
  [1e9, 1e6, "ms"],
  [60e9, 1e9, "s"],
  [3600e9, 60e9, "min"],
  [Number.POSITIVE_INFINITY, 3600e9, "h"],
];

const BYTE_SUFFIXES = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

/** Formats a sample value by the profile's sample unit (OTel/pprof unit names). */
export function formatProfileValue(value: number, unit: string): string {
  const normalized = unit.toLowerCase();
  const nsFactor = NANOSECONDS_PER[normalized];
  if (nsFactor !== undefined) return formatDuration(value * nsFactor);
  if (normalized === "bytes" || normalized === "byte") return formatBytes(value);
  if (normalized === "count" || normalized === "") {
    return `${integer.format(value)} ${value === 1 ? "sample" : "samples"}`;
  }
  return `${integer.format(value)} ${unit}`;
}

function formatDuration(ns: number): string {
  const abs = Math.abs(ns);
  const step = DURATION_STEPS.find(([limit]) => abs < limit) ?? DURATION_STEPS[0];
  const [, divisor, suffix] = step;
  return `${significant.format(ns / divisor)} ${suffix}`;
}

function formatBytes(bytes: number): string {
  let scaled = bytes;
  let index = 0;
  while (Math.abs(scaled) >= 1024 && index < BYTE_SUFFIXES.length - 1) {
    scaled /= 1024;
    index++;
  }
  return `${index === 0 ? integer.format(scaled) : significant.format(scaled)} ${BYTE_SUFFIXES[index]}`;
}

export function formatPercent(part: number, total: number): string {
  if (total <= 0) return "0%";
  const percent = (part / total) * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${Number(percent.toFixed(2))}%`;
}
