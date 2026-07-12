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
 * Notification templates are rendered by clickety-clack, which resolves
 * `${x}` against the event's instance labels first, then `${value}` (the
 * rule's `value_column`), then the event's evidence: every remaining query
 * result column, capped at 16 columns / 4096 bytes of compact JSON (over the
 * byte cap the evidence is dropped and refs into it render empty). Any query
 * result column is therefore a valid reference; anything else would silently
 * render as empty text, so it is rejected here against the columns the query
 * actually returned at apply time.
 */
export function validateMessageRefs(
  template: string,
  columns: readonly string[],
  hasValueColumn: boolean,
): void {
  const known = new Set(columns);
  for (const name of extractVariables(template)) {
    if (name === "value") {
      // ${value} resolves to the rule's value column, or (when valueColumn is
      // not set) falls through to a result column literally named "value".
      if (!hasValueColumn && !known.has("value")) {
        throw new Error(
          `\${value} requires spec.valueColumn: set valueColumn to the numeric column the alert should carry`,
        );
      }
      continue;
    }
    if (!known.has(name)) {
      const available =
        columns.length > 0
          ? ` (available: ${columns.join(", ")})`
          : " (the query returned no columns)";
      throw new Error(
        `\${${name}} is not a column of the query result: notification templates can reference any query result column${available} or \${value}`,
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
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

/**
 * Render an instance's notification message the way clickety-clack's
 * dispatcher does: `${x}` resolves against the instance labels first, then
 * `${value}` (the alert's carried value), then the event's evidence columns;
 * unresolved refs render as empty text. This is what the UI shows wherever it
 * answers "what would this alert have told me".
 */
export function renderInstanceMessage(
  template: string,
  ctx: {
    labels: Record<string, string>;
    value?: unknown;
    evidence?: Record<string, unknown> | null;
  },
): string {
  const firstRow: Record<string, unknown> = {
    ...(ctx.evidence ?? {}),
    ...ctx.labels,
  };
  if (ctx.value !== undefined && ctx.value !== null) firstRow.value = ctx.value;
  return renderMessage(template, { firstRow });
}
