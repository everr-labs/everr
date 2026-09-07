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

// Reject variables that the query does not return.
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
