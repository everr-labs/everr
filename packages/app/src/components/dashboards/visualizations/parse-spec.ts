import type * as z from "zod";

export interface ParsedSpec<T> {
  spec: T;
  /** Human-readable "path: problem" entries for options that were ignored. */
  warnings: string[];
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Parse a plugin spec without ever failing: invalid options are dropped (their
 * schema defaults apply instead) and reported as warnings so the UI can
 * surface them. The strict counterpart runs at apply time; this lenient path
 * exists so a stored dashboard that predates validation still renders.
 *
 * Requires a schema where `{}` parses (all known fields defaulted/optional).
 */
export function parseSpecLenient<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): ParsedSpec<z.output<S>> {
  const strict = schema.safeParse(raw);
  if (strict.success) return { spec: strict.data, warnings: [] };

  const warnings = strict.error.issues.map(formatIssue);
  const cleaned: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  for (const issue of strict.error.issues) {
    const head = issue.path[0];
    if (typeof head === "string") delete cleaned[head];
  }

  const lenient = schema.safeParse(cleaned);
  // Stripping every offending top-level key leaves only valid fields, so this
  // parse can only fail if the schema breaks the `{}`-parses contract.
  if (lenient.success) return { spec: lenient.data, warnings };
  return { spec: schema.parse({}), warnings };
}
