import type { MetricAggregation, MetricKind } from "../data/schemas";

const formats = new Map<string, Intl.NumberFormat>();
// Three significant digits, unless a caller needs more to tell values apart.
function numberFormat(digits: number, notation: "standard" | "compact" = "standard") {
  const key = `${digits}:${notation}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(undefined, { maximumSignificantDigits: digits, notation });
    formats.set(key, format);
  }
  return format;
}
const compact = numberFormat(3, "compact");
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

function formatDuration(seconds: number, digits: number): string {
  if (seconds === 0) return "0 s";
  const abs = Math.abs(seconds);
  let index = DURATION_STEPS.findIndex(([s]) => abs >= s);
  if (index === -1) index = DURATION_STEPS.length - 1;
  // A value that rounds up into the next unit reads in it: 0.9996 s is 1 s, not 1,000 ms.
  const [current] = DURATION_STEPS[index] ?? [1];
  const [above] = DURATION_STEPS[index - 1] ?? [Infinity];
  // The rounded value, so 59.96 s reads 1 min, not 0.999 min.
  const rounded = Number((seconds / current).toPrecision(digits)) * current;
  if (Math.abs(rounded) >= above) index -= 1;
  const [scale, label] = DURATION_STEPS[index] ?? [1, "s"];
  return `${numberFormat(digits).format(rounded / scale)} ${label}`;
}

function formatBytes(bytes: number, digits: number): string {
  let value = bytes;
  let step = 0;
  while (Math.abs(value) >= 1024 && step < BYTE_STEPS.length - 1) {
    value /= 1024;
    step += 1;
  }
  return `${numberFormat(digits).format(value)} ${BYTE_STEPS[step]}`;
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

// A unit comes from the data: "constructor" or "__proto__" are unknown units,
// not the lookup objects' inherited properties.
function known<T>(table: Record<string, T>, unit: string): T | undefined {
  return Object.hasOwn(table, unit) ? table[unit] : undefined;
}

/**
 * The UCUM unit OpenTelemetry sends, spelled out: `By` reads "bytes",
 * `By/s` "bytes/s", and a `{request}` annotation "request". Codes it doesn't
 * know stay as sent.
 */
export function unitName(unit: string): string {
  const name = known(UNIT_NAMES, unit);
  if (name) return name;
  return unit
    .split("/")
    .map((part, i) => {
      const annotation = /^\{(.*)\}$/.exec(part)?.[1];
      if (annotation !== undefined) return annotation;
      // After a slash, a time unit reads better short: bytes/s, not bytes/seconds.
      return i > 0 ? part : (known(UNIT_NAMES, part) ?? part);
    })
    .join("/");
}

// Byte units, in bytes, so every size scales the same way.
const BYTES: Record<string, number> = {
  By: 1,
  kBy: 1e3,
  MBy: 1e6,
  GBy: 1e9,
  KiBy: 1024,
  MiBy: 1024 ** 2,
  GiBy: 1024 ** 3,
  TiBy: 1024 ** 4,
};

const SYMBOLS: Record<string, string> = { Cel: "°C" };

/**
 * A value in its UCUM unit as OpenTelemetry sends it: durations and bytes
 * scale to a readable size, a unit per second such as `By/s` scales its
 * numerator, `{request}`-style annotations and the dimensionless `1` print as
 * plain numbers, and any other unit is appended. `digits` significant digits,
 * three by default.
 */
export function formatMetricValue(
  value: number,
  unit: string,
  aggregation?: MetricAggregation,
  digits = 3,
): string {
  const perSecond = aggregation === "rate" ? "/s" : "";
  if (unit.length > 2 && unit.endsWith("/s")) {
    return `${formatMetricValue(value, unit.slice(0, -2), undefined, digits)}/s${perSecond}`;
  }
  const seconds = known(DURATION_SECONDS, unit);
  if (seconds !== undefined) return formatDuration(value * seconds, digits) + perSecond;
  const bytes = known(BYTES, unit);
  if (bytes !== undefined) return formatBytes(value * bytes, digits) + perSecond;
  if (unit === "%") return `${numberFormat(digits).format(value)}%${perSecond}`;
  const plain = numberFormat(digits, "compact").format(value);
  if (unit === "" || unit === "1" || /^\{.*\}$/.test(unit)) return plain + perSecond;
  return `${plain} ${known(SYMBOLS, unit) ?? unit}${perSecond}`;
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
