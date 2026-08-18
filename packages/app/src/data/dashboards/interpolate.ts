/**
 * Grafana-style variable interpolation for dashboard panel SQL.
 * Pure module — runs server-side in runPanelQuery, importable in tests.
 *
 * Token syntax: `$name`, `${name}`, `${name:raw}`. `$name` ends at the first
 * character outside [a-zA-Z0-9_]. Unknown names are left untouched (they may
 * be ClickHouse syntax such as dollar-quoted strings).
 */

/** Sentinel stored as the *sole* value when "All" is selected. */
export const ALL_VALUE = "__all";

/** Effective values keyed by variable name. */
export type VariableValues = Record<string, string | string[]>;

/** Per-variable metadata interpolation needs to expand the All sentinel. */
export interface VariableAllMeta {
  customAllValue?: string;
  options?: string[];
}

export type VariableMeta = Record<string, VariableAllMeta>;

const TOKEN_RE =
  /\$\{([a-zA-Z_][a-zA-Z0-9_]*)(?::(raw))?\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Escape a string for use inside a ClickHouse single-quoted literal. */
function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** A ClickHouse single-quoted string literal, safely escaped. */
function sqlLiteral(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

/** Empty lists become (NULL) so `IN (NULL)` deterministically matches nothing. */
function sqlList(values: string[]): string {
  if (values.length === 0) return "(NULL)";
  return `(${values.map(sqlLiteral).join(",")})`;
}

export function interpolateVariables(
  sql: string,
  values: VariableValues,
  meta: VariableMeta = {},
): string {
  return sql.replace(TOKEN_RE, (match, braced, modifier, bare) => {
    const name: string = braced ?? bare;
    if (!(name in values)) return match;
    const value = values[name]!;
    const raw = modifier === "raw";

    // The sentinel only means "All" for variables the caller supplied All
    // metadata for (the client always does for All-valued list variables).
    // Without it — e.g. a text variable literally set to "__all" — the
    // sentinel string is treated as a plain value.
    const allMeta = value === ALL_VALUE ? meta[name] : undefined;
    if (allMeta) {
      if (allMeta.customAllValue !== undefined) return allMeta.customAllValue;
      const options = allMeta.options ?? [];
      return raw ? options.join(",") : sqlList(options);
    }

    if (raw) return Array.isArray(value) ? value.join(",") : value;
    return Array.isArray(value) ? sqlList(value) : sqlLiteral(value);
  });
}

/** Unique variable names referenced by `sql`, in order of first appearance. */
export function extractVariableTokens(sql: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of sql.matchAll(TOKEN_RE)) {
    const name = match[1] ?? match[3];
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
