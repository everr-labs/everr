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
  extractVariables(template);
}

export function validateMessageColumns(
  template: string,
  columns: readonly string[],
): void {
  const names = new Set(columns);
  for (const name of extractVariables(template)) {
    if (name === "row_count") continue;
    if (!names.has(name)) {
      throw new Error(
        `\${${name}} references column "${name}" which the query does not return`,
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
    const value = ctx.firstRow?.[name];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}
