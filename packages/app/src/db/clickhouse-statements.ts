import { createHash } from "node:crypto";

/** Directories whose top-level `*.sql` files are ClickHouse migrations. */
export const CLICKHOUSE_MIGRATION_DIRS = [
  "packages/app/clickhouse/shared",
  "packages/app/clickhouse/self-hosted",
  "packages/cloud/clickhouse",
] as const;

/** A path the migration runner loads. Nested files, including `repeatable/`, are not. */
export function isClickHouseMigrationPath(path: string): boolean {
  return CLICKHOUSE_MIGRATION_DIRS.some((dir) => {
    if (!path.startsWith(`${dir}/`)) return false;
    const name = path.slice(dir.length + 1);
    return name.endsWith(".sql") && !name.includes("/");
  });
}

/**
 * Paths in `base` whose text differs in `head`, including a file `head`
 * dropped. A new file is not a change. Any edit is, a comment included.
 */
export function changedClickHouseMigrationFiles(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [path, sql] of base) {
    if (head.get(path) !== sql) changed.push(path);
  }
  return changed.sort();
}

/** The hash of a file's text as written. Any edit to an applied file changes it. */
export function clickHouseMigrationHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * A file's statements, to send one at a time. Drops `--` line comments, then
 * splits on `;`. It does not read quotes: a migration cannot put `;` or `--`
 * inside a quoted string. Block comments are not recognized.
 */
export function sqlStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}
