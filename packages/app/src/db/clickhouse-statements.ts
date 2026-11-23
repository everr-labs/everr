import { createHash } from "node:crypto";

/** The one directory whose top-level `*.sql` files are ClickHouse migrations. */
export const CLICKHOUSE_MIGRATION_DIR = "packages/app/clickhouse";

/** A path the migration runner loads. Nested files are not. */
export function isClickHouseMigrationPath(path: string): boolean {
  if (!path.startsWith(`${CLICKHOUSE_MIGRATION_DIR}/`)) return false;
  const name = path.slice(CLICKHOUSE_MIGRATION_DIR.length + 1);
  return name.endsWith(".sql") && !name.includes("/");
}

const SEED_SUFFIX = ".seed.ts";

/**
 * Seed files among `head` that `base` lacks, for a migration `base`
 * already has. A seed runs once, with its migration, so one added later
 * never runs where that migration is applied.
 */
export function lateClickHouseSeedFiles(
  base: ReadonlySet<string>,
  head: Iterable<string>,
): string[] {
  const late: string[] = [];
  for (const path of head) {
    if (!path.endsWith(SEED_SUFFIX) || base.has(path)) continue;
    if (base.has(`${path.slice(0, -SEED_SUFFIX.length)}.sql`)) late.push(path);
  }
  return late.sort();
}

export function droppedClickHouseSeedFiles(
  base: ReadonlySet<string>,
  head: ReadonlySet<string>,
): string[] {
  return [...base].filter((path) => path.endsWith(SEED_SUFFIX) && !head.has(path)).sort();
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
