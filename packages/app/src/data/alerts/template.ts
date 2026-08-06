const VARIABLE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function extractVariables(template: string): string[] {
  return [...template.matchAll(VARIABLE_RE)].map((match) => match[1]);
}

export function validateQueryTemplate(query: string): void {
  const [name] = extractVariables(query);
  if (name !== undefined) {
    throw new Error(
      `unsupported query variable \${${name}}: query templates do not support variables`,
    );
  }
}

/**
 * Notification templates are rendered by the alert worker, which resolves
 * `${x}` against the event's instance labels first, then `${value}` (the
 * query's required `value` column), then the event's evidence: every remaining query
 * result column, capped at 16 columns / 4096 bytes of compact JSON (over the
 * byte cap the evidence is dropped and refs into it render empty). Any query
 * result column is therefore a valid reference; anything else would silently
 * render as empty text, so it is rejected here against the columns the query
 * actually returned at apply time.
 */
export function validateMessageRefs(
  template: string,
  columns: readonly string[],
): void {
  const known = new Set(columns);
  for (const name of extractVariables(template)) {
    if (!known.has(name)) {
      const available =
        columns.length > 0
          ? ` (available: ${columns.join(", ")})`
          : " (the query returned no columns)";
      throw new Error(
        `\${${name}} is not a column of the query result: notification templates can reference any query result column${available}`,
      );
    }
  }
}

export function renderMessage(
  template: string,
  ctx: { firstRow: Record<string, unknown> | undefined },
): string {
  return template.replace(VARIABLE_RE, (_, name: string) => {
    const value = ctx.firstRow?.[name];
    return value === undefined || value === null ? "" : String(value);
  });
}
