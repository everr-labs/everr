const COMPACT_SUFFIXES: ReadonlyArray<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];

type UnitDimension = "bytes" | "duration";
type UnitSystem = "binary" | "decimal" | "duration";

interface SemanticUnit {
  dimension: UnitDimension;
  factor: number;
  label: string;
  system: UnitSystem;
}

const UNITS: Readonly<Record<string, SemanticUnit>> = {
  By: { dimension: "bytes", factor: 1, label: "B", system: "binary" },
  bytes: { dimension: "bytes", factor: 1, label: "B", system: "binary" },
  B: { dimension: "bytes", factor: 1, label: "B", system: "binary" },
  kBy: { dimension: "bytes", factor: 1e3, label: "kB", system: "decimal" },
  KBy: { dimension: "bytes", factor: 1e3, label: "kB", system: "decimal" },
  KB: { dimension: "bytes", factor: 1e3, label: "kB", system: "decimal" },
  MBy: { dimension: "bytes", factor: 1e6, label: "MB", system: "decimal" },
  MB: { dimension: "bytes", factor: 1e6, label: "MB", system: "decimal" },
  GBy: { dimension: "bytes", factor: 1e9, label: "GB", system: "decimal" },
  GB: { dimension: "bytes", factor: 1e9, label: "GB", system: "decimal" },
  TBy: { dimension: "bytes", factor: 1e12, label: "TB", system: "decimal" },
  TB: { dimension: "bytes", factor: 1e12, label: "TB", system: "decimal" },
  PBy: { dimension: "bytes", factor: 1e15, label: "PB", system: "decimal" },
  PB: { dimension: "bytes", factor: 1e15, label: "PB", system: "decimal" },
  KiBy: { dimension: "bytes", factor: 1024, label: "KiB", system: "binary" },
  KiB: { dimension: "bytes", factor: 1024, label: "KiB", system: "binary" },
  MiBy: {
    dimension: "bytes",
    factor: 1024 ** 2,
    label: "MiB",
    system: "binary",
  },
  MiB: {
    dimension: "bytes",
    factor: 1024 ** 2,
    label: "MiB",
    system: "binary",
  },
  GiBy: {
    dimension: "bytes",
    factor: 1024 ** 3,
    label: "GiB",
    system: "binary",
  },
  GiB: {
    dimension: "bytes",
    factor: 1024 ** 3,
    label: "GiB",
    system: "binary",
  },
  TiBy: {
    dimension: "bytes",
    factor: 1024 ** 4,
    label: "TiB",
    system: "binary",
  },
  TiB: {
    dimension: "bytes",
    factor: 1024 ** 4,
    label: "TiB",
    system: "binary",
  },
  PiBy: {
    dimension: "bytes",
    factor: 1024 ** 5,
    label: "PiB",
    system: "binary",
  },
  PiB: {
    dimension: "bytes",
    factor: 1024 ** 5,
    label: "PiB",
    system: "binary",
  },
  ns: { dimension: "duration", factor: 1e-9, label: "ns", system: "duration" },
  us: { dimension: "duration", factor: 1e-6, label: "µs", system: "duration" },
  µs: {
    dimension: "duration",
    factor: 1e-6,
    label: "µs",
    system: "duration",
  },
  ms: { dimension: "duration", factor: 1e-3, label: "ms", system: "duration" },
  s: { dimension: "duration", factor: 1, label: "s", system: "duration" },
  min: { dimension: "duration", factor: 60, label: "min", system: "duration" },
  h: { dimension: "duration", factor: 3600, label: "h", system: "duration" },
  d: { dimension: "duration", factor: 86400, label: "d", system: "duration" },
};

const BINARY_BYTE_UNITS = ["PiBy", "TiBy", "GiBy", "MiBy", "KiBy", "By"];
const DECIMAL_BYTE_UNITS = ["PBy", "TBy", "GBy", "MBy", "kBy", "By"];
const DURATION_UNITS = ["d", "h", "min", "s", "ms", "us", "ns"];

interface FormatValueOptions {
  decimals?: number;
  compact?: boolean;
  displayUnit?: "auto";
  locale?: boolean;
  unitSeparator?: string;
}

export interface FormattedValueParts {
  value: string;
  unit: string;
}

function fractionDigits(decimals?: number): Intl.NumberFormatOptions {
  return decimals === undefined
    ? { maximumFractionDigits: 2 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
}

export function formatCompactValue(value: number, decimals?: number): string {
  const fraction = fractionDigits(decimals);
  for (const [factor, suffix] of COMPACT_SUFFIXES) {
    if (Math.abs(value) >= factor) {
      return `${(value / factor).toLocaleString(undefined, fraction)}${suffix}`;
    }
  }
  return value.toLocaleString(undefined, fraction);
}

function autoUnit(input: SemanticUnit, baseValue: number): SemanticUnit {
  const candidates =
    input.dimension === "duration"
      ? DURATION_UNITS
      : input.system === "decimal"
        ? DECIMAL_BYTE_UNITS
        : BINARY_BYTE_UNITS;
  if (baseValue === 0) return input;
  const magnitude = Math.abs(baseValue);
  for (const candidate of candidates) {
    const resolved = UNITS[candidate];
    if (resolved && magnitude >= resolved.factor) return resolved;
  }
  return UNITS[candidates.at(-1) ?? ""] ?? input;
}

function semanticParts(
  value: number,
  unit: string,
  decimals?: number,
): FormattedValueParts | undefined {
  const input = UNITS[unit];
  if (!input) return undefined;
  const baseValue = value * input.factor;
  const output = autoUnit(input, baseValue);
  return {
    value: (baseValue / output.factor).toLocaleString(
      undefined,
      fractionDigits(decimals),
    ),
    unit: output.label,
  };
}

export function formatValueParts(
  value: number,
  unit: string,
  options: Pick<
    FormatValueOptions,
    "decimals" | "compact" | "displayUnit"
  > = {},
): FormattedValueParts {
  if (options.displayUnit === "auto") {
    const semantic = semanticParts(value, unit, options.decimals);
    if (semantic) return semantic;
  }

  return {
    value: options.compact
      ? formatCompactValue(value, options.decimals)
      : value.toLocaleString(undefined, fractionDigits(options.decimals)),
    unit,
  };
}

export function formatValue(
  value: number,
  unit: string,
  options: FormatValueOptions = {},
): string {
  if (options.displayUnit === "auto") {
    const semantic = semanticParts(value, unit, options.decimals);
    if (semantic) return `${semantic.value} ${semantic.unit}`;
  }

  const formatted = options.compact
    ? formatCompactValue(value, options.decimals)
    : options.locale === false
      ? String(value)
      : value.toLocaleString(undefined, fractionDigits(options.decimals));
  return unit ? `${formatted}${options.unitSeparator ?? ""}${unit}` : formatted;
}
