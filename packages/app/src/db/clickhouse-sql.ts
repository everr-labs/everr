/**
 * One SQL file. Its file name orders it and keys it in the journal. It is
 * immutable once applied: changing it stops startup.
 */
export interface ClickHouseMigration {
  readonly name: string;
  readonly sql: string;
}

/** Files from `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`. */
export function clickHouseMigrationsFrom(files: Record<string, string>): ClickHouseMigration[] {
  return Object.entries(files).map(([path, sql]) => ({
    name: path.slice(path.lastIndexOf("/") + 1),
    sql,
  }));
}

/** Table definitions and SQL query limits that App and Cloud share. */
export const sharedClickHouseMigrations = clickHouseMigrationsFrom(
  import.meta.glob<string>("../../clickhouse/shared/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

// Strip line comments before splitting statements: comments can contain semicolons.
export function sqlStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
