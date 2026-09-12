import { durationUnits, type ValueFormat } from "./value-format-spec";

const DECIMAL_PREFIXES = ["", "k", "M", "G", "T", "P", "E", "Z", "Y"];
const BINARY_PREFIXES = ["", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi", "Yi"];
const DURATION_STEPS: ReadonlyArray<readonly [number, string]> = [
  [86400, "d"],
  [3600, "h"],
  [60, "min"],
  [1, "s"],
  [1e-3, "ms"],
  [1e-6, "us"],
  [1e-9, "ns"],
];
const DECIMAL_DURATION_STEPS = DURATION_STEPS.filter(([factor]) => factor <= 1);

interface FormattedValueParts {
  value: string;
  unit: string;
}

/** Present common OTel/UCUM codes without treating unknown units as aliases. */
function unitLabel(unit: string): string {
  if (unit === "1") return "";
  const rate = /^(.*)\/(ns|us|ms|s|min|h|d)$/.exec(unit);
  const atom = rate?.[1] ?? unit;
  const bytes = /^((?:[KMGT]i|[kMGTPEZYmunp])?)By$/.exec(atom);
  const label = bytes
    ? `${bytes[1]}B`
    : atom === "Cel"
      ? "°C"
      : atom === "us"
        ? "µs"
        : /^\{[^{}]+\}$/.test(atom)
          ? atom.slice(1, -1)
          : atom;
  return rate ? `${label}/${rate[2] === "us" ? "µs" : rate[2]}` : label;
}

function numberFormatter(decimals?: number, useGrouping = true) {
  return new Intl.NumberFormat(undefined, {
    useGrouping,
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  });
}

/** Resolves presentation once; all geometry and thresholds keep raw query values. */
export function createValueFormatter(
  format: ValueFormat = { unit: "", scale: "none" },
) {
  const { unit, decimals } = format;
  const percent = format.display === "percent";
  const label = percent ? "%" : unitLabel(unit);
  const numbers = numberFormatter(decimals);
  const axisNumbers = numberFormatter(decimals, false);
  const separator = label === "%" ? "" : " ";

  function parts(
    value: number,
    reference = value,
    axis = false,
  ): FormattedValueParts {
    const formatter = axis ? axisNumbers : numbers;
    if (percent) return { value: formatter.format(value * 100), unit: label };
    if (!Number.isFinite(value))
      return { value: formatter.format(value), unit: label };
    const magnitude = Number.isFinite(reference)
      ? Math.abs(reference)
      : Math.abs(value);
    if (
      format.scale === "duration" ||
      (format.scale === "decimal" && Object.hasOwn(durationUnits, unit))
    ) {
      const inputFactor = durationUnits[unit] ?? 1;
      const steps =
        format.scale === "duration" ? DURATION_STEPS : DECIMAL_DURATION_STEPS;
      const [factor, label] =
        magnitude === 0
          ? [inputFactor, unit]
          : (steps.find(([factor]) => magnitude * inputFactor >= factor) ?? [
              1e-9,
              "ns",
            ]);
      return {
        value: formatter.format(value * (inputFactor / factor)),
        unit: unitLabel(label),
      };
    }
    if (format.scale === "decimal" || format.scale === "binary") {
      const base = format.scale === "binary" ? 1024 : 1000;
      const prefixes =
        format.scale === "binary" ? BINARY_PREFIXES : DECIMAL_PREFIXES;
      let index = 0;
      while (index < prefixes.length - 1 && magnitude >= base ** (index + 1))
        index++;
      const prefix = prefixes[index] ?? "";
      // SI symbols use decimal prefixes; binary prefixes remain byte/bit-specific.
      const prefixOnUnit =
        /^(By|bit)(\/.*)?$/.test(unit) ||
        (format.scale === "decimal" && /^(Hz|W|J|V|A)$/.test(unit));
      return prefixOnUnit
        ? {
            value: formatter.format(value / base ** index),
            unit: prefix + label,
          }
        : {
            value: formatter.format(value / base ** index) + prefix,
            unit: label,
          };
    }
    return { value: formatter.format(value), unit: label };
  }

  function join(formatted: FormattedValueParts) {
    return formatted.unit
      ? formatted.value + separator + formatted.unit
      : formatted.value;
  }

  return {
    parts: (value: number) => parts(value),
    format: (value: number) => join(parts(value)),
    /** Fix one scale for the entire axis, selected from its largest magnitude. */
    axis: (reference: number) => (value: number) =>
      join(parts(value, reference, true)),
  };
}
