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

export function validateMessageTemplate(template: string): void {
  for (const name of extractVariables(template)) {
    if (name === "row_count" || name.startsWith("top_")) continue;
    throw new Error(
      `unsupported variable \${${name}}: summary/description support \${row_count} and \${top_<column>}`,
    );
  }
}

export function validateTopColumns(
  template: string,
  columns: readonly string[],
): void {
  const names = new Set(columns);
  for (const name of extractVariables(template)) {
    if (!name.startsWith("top_")) continue;
    const column = name.slice("top_".length);
    if (!names.has(column)) {
      throw new Error(
        `\${${name}} references column "${column}" which the query does not return`,
      );
    }
  }
}

export function renderMessage(
  template: string,
  ctx: { rowCount: number; firstRow: Record<string, unknown> | undefined },
): string {
  return template.replace(VARIABLE_RE, (_, name: string) => {
    if (name === "row_count") return String(ctx.rowCount);
    if (name.startsWith("top_")) {
      const value = ctx.firstRow?.[name.slice("top_".length)];
      return value === undefined || value === null ? "" : String(value);
    }
    return "";
  });
}
