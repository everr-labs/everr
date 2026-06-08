/**
 * Effective variable value resolution: URL `vars` param wins, spec defaults
 * apply otherwise. Normalization: multi-select variables always resolve to
 * arrays, single-select to strings; the All sentinel only when allowAllValue.
 * Invalid shapes fall back to the default. Pure module.
 */
import {
  ALL_VALUE,
  type VariableMeta,
  type VariableValues,
} from "./interpolate";
import type { ListVariable, Variable } from "./schema";

/** Valid variable names; also enforced by the variables manager. */
export const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type VariableUrlValues = Record<string, string | string[]>;

export type ListVariableSource =
  | { kind: "static"; values: string[] }
  | { kind: "query"; query: string }
  | { kind: "unknown" };

/** Typed reader over the loose `plugin: { kind, spec }` of a ListVariable. */
export function getListVariableSource(
  variable: ListVariable,
): ListVariableSource {
  const { kind, spec } = variable.spec.plugin;
  if (kind === "StaticListVariable" && Array.isArray(spec.values)) {
    return {
      kind: "static",
      values: spec.values.filter((v): v is string => typeof v === "string"),
    };
  }
  if (kind === "ClickHouseSQLVariable" && typeof spec.query === "string") {
    return { kind: "query", query: spec.query };
  }
  return { kind: "unknown" };
}

function normalizeListValue(
  value: string | string[] | undefined,
  multi: boolean,
  allowAll: boolean,
): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    // Sentinel without allowAllValue is invalid; the caller falls back to the
    // default (which may itself be invalid → the variable resolves as missing).
    if (value === ALL_VALUE) return allowAll ? ALL_VALUE : undefined;
    if (value === "") return undefined;
    return multi ? [value] : value;
  }
  // Arrays are only valid for multi-select, and never contain the sentinel.
  if (!multi) return undefined;
  if (value.some((entry) => entry === ALL_VALUE)) return undefined;
  return value;
}

function effectiveValue(
  variable: Variable,
  urlValue: string | string[] | undefined,
): string | string[] | undefined {
  if (variable.kind === "TextVariable") {
    const candidate = typeof urlValue === "string" ? urlValue : undefined;
    const resolved =
      candidate !== undefined && candidate !== ""
        ? candidate
        : variable.spec.value;
    return resolved === "" ? undefined : resolved;
  }
  const multi = variable.spec.allowMultiple === true;
  const allowAll = variable.spec.allowAllValue === true;
  return (
    normalizeListValue(urlValue, multi, allowAll) ??
    normalizeListValue(variable.spec.defaultValue, multi, allowAll)
  );
}

/**
 * Resolve effective values for all variables. Variables with no effective
 * value (no URL value, no default, empty text) are omitted from the result.
 */
export function effectiveVariableValues(
  variables: Variable[],
  urlVars: VariableUrlValues | undefined,
): VariableValues {
  const result: VariableValues = {};
  for (const variable of variables) {
    const value = effectiveValue(variable, urlVars?.[variable.spec.name]);
    if (value !== undefined) result[variable.spec.name] = value;
  }
  return result;
}

/**
 * Build the interpolation metadata for variables currently set to All.
 *
 * Query-backed variables without customAllValue need loaded options. Their
 * names are reported in:
 * - `pendingAllNames` while options are still loading, so panels hold off; or
 * - `allErrors` when options cannot be expanded — either the options query
 *   failed, or the option set was truncated (capped) so "All" would silently
 *   expand to a partial set. In both cases panels must surface the error rather
 *   than expand incomplete data or wait forever.
 */
export function buildAllMeta(
  variables: Variable[],
  values: VariableValues,
  optionsByName: Record<
    string,
    { options?: string[]; error?: string; truncated?: boolean } | undefined
  >,
): {
  meta: VariableMeta;
  pendingAllNames: string[];
  allErrors: Record<string, string>;
} {
  const meta: VariableMeta = {};
  const pendingAllNames: string[] = [];
  const allErrors: Record<string, string> = {};
  for (const variable of variables) {
    // Text variables are skipped: a text value that happens to equal the
    // sentinel string is just a literal value, not an All selection.
    if (variable.kind !== "ListVariable") continue;
    const name = variable.spec.name;
    if (values[name] !== ALL_VALUE) continue;
    if (variable.spec.customAllValue !== undefined) {
      meta[name] = { customAllValue: variable.spec.customAllValue };
      continue;
    }
    const state = optionsByName[name];
    if (state?.error !== undefined) {
      allErrors[name] = `Failed to load options for $${name}: ${state.error}`;
      continue;
    }
    if (state?.truncated) {
      // Expanding to the capped option set would silently drop values.
      allErrors[name] =
        `Variable "$${name}" has too many values to expand "All"`;
      continue;
    }
    if (state?.options) {
      meta[name] = { options: state.options };
    } else {
      pendingAllNames.push(name);
    }
  }
  return { meta, pendingAllNames, allErrors };
}

export type ListVariableSort = ListVariable["spec"]["sort"];

/**
 * Sort a list of variable option strings according to the given sort spec.
 * Never mutates the input array.
 */
export function sortVariableOptions(
  options: string[],
  sort: ListVariableSort,
): string[] {
  if (sort === undefined || sort === "none") return options;

  const copy = [...options];

  switch (sort) {
    case "alphabetical-asc":
      return copy.sort((a, b) => a.localeCompare(b));
    case "alphabetical-desc":
      return copy.sort((a, b) => b.localeCompare(a));
    case "alphabetical-ci-asc":
      return copy.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
    case "alphabetical-ci-desc":
      return copy.sort((a, b) =>
        b.localeCompare(a, undefined, { sensitivity: "base" }),
      );
    case "numerical-asc": {
      const toNum = (v: string) => {
        const n = Number(v);
        return Number.isNaN(n) ? Infinity : n;
      };
      return copy.sort((a, b) => toNum(a) - toNum(b));
    }
    case "numerical-desc": {
      const toNum = (v: string) => {
        const n = Number(v);
        return Number.isNaN(n) ? -Infinity : n;
      };
      return copy.sort((a, b) => toNum(b) - toNum(a));
    }
  }
}

/** Subset a record to the given keys (used to scope values/meta per panel). */
export function pickByNames<T>(
  record: Record<string, T>,
  names: string[],
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const name of names) {
    if (name in record) result[name] = record[name]!;
  }
  return result;
}
