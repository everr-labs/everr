import type { MetricAggregation, MetricKind } from "../data/schemas";

const number = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });
const compact = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 3,
  notation: "compact",
});
const count = new Intl.NumberFormat();

export const formatCount = (value: number) => count.format(value);
export const formatCompact = (value: number) => compact.format(value);

const DURATION_SECONDS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  min: 60,
  h: 3600,
  d: 86_400,
};
const DURATION_STEPS: [number, string][] = [
  [86_400, "d"],
  [3600, "h"],
  [60, "min"],
  [1, "s"],
  [1e-3, "ms"],
  [1e-6, "µs"],
  [1e-9, "ns"],
];
const BYTE_STEPS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0 s";
  const abs = Math.abs(seconds);
  const [scale, label] = DURATION_STEPS.find(([s]) => abs >= s) ?? [1e-9, "ns"];
  return `${number.format(seconds / scale)} ${label}`;
}

function formatBytes(bytes: number): string {
  let value = bytes;
  let step = 0;
  while (Math.abs(value) >= 1024 && step < BYTE_STEPS.length - 1) {
    value /= 1024;
    step += 1;
  }
  return `${number.format(value)} ${BYTE_STEPS[step]}`;
}

const UNIT_NAMES: Record<string, string> = {
  By: "bytes",
  KiBy: "kibibytes",
  MiBy: "mebibytes",
  GiBy: "gibibytes",
  bit: "bits",
  ns: "nanoseconds",
  us: "microseconds",
  ms: "milliseconds",
  s: "seconds",
  min: "minutes",
  h: "hours",
  d: "days",
  "%": "percent",
  "1": "dimensionless",
  Cel: "degrees Celsius",
  Hz: "hertz",
};

/**
 * The UCUM unit OpenTelemetry sends, spelled out: `By` reads "bytes",
 * `By/s` "bytes/s", and a `{request}` annotation "request". Codes it doesn't
 * know stay as sent.
 */
export function unitName(unit: string): string {
  if (UNIT_NAMES[unit]) return UNIT_NAMES[unit];
  return unit
    .split("/")
    .map((part, i) => {
      const annotation = /^\{(.*)\}$/.exec(part)?.[1];
      if (annotation !== undefined) return annotation;
      // After a slash, a time unit reads better short: bytes/s, not bytes/seconds.
      return i > 0 ? part : (UNIT_NAMES[part] ?? part);
    })
    .join("/");
}

/**
 * A value in its UCUM unit as OpenTelemetry sends it: durations and bytes
 * scale to a readable size, `{request}`-style annotations and the
 * dimensionless `1` print as plain numbers, and any other unit is appended.
 */
export function formatMetricValue(
  value: number,
  unit: string,
  aggregation?: MetricAggregation,
): string {
  const perSecond = aggregation === "rate" ? "/s" : "";
  const seconds = DURATION_SECONDS[unit];
  if (seconds !== undefined) return formatDuration(value * seconds) + perSecond;
  if (unit === "By") return formatBytes(value) + perSecond;
  if (unit === "%") return `${number.format(value)}%${perSecond}`;
  const plain = compact.format(value);
  if (unit === "" || unit === "1" || /^\{.*\}$/.test(unit)) return plain + perSecond;
  return `${plain} ${unit}${perSecond}`;
}

export const METRIC_KIND_LABELS: Record<MetricKind, string> = {
  gauge: "Gauge",
  counter: "Counter",
  updown: "UpDownCounter",
  histogram: "Histogram",
  exponential_histogram: "Exponential histogram",
  summary: "Summary",
};

/** For lists and filters, where "Exponential histogram" is too wide. */
export const METRIC_KIND_SHORT_LABELS: Record<MetricKind, string> = {
  ...METRIC_KIND_LABELS,
  exponential_histogram: "Exp. histogram",
};

export function temporalityLabel(temporality: number): string | null {
  if (temporality === 1) return "delta";
  if (temporality === 2) return "cumulative";
  return null;
}
