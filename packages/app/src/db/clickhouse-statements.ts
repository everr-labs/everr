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
 * Paths in `base` whose statements differ in `head`, including a file `head`
 * dropped. A new file is not a change. Comment and whitespace edits are not,
 * because the hash ignores them.
 */
export function changedClickHouseMigrationFiles(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
): string[] {
  const changed: string[] = [];
  for (const [path, sql] of base) {
    const next = head.get(path);
    if (next === undefined || clickHouseMigrationHash(sql) !== clickHouseMigrationHash(next)) {
      changed.push(path);
    }
  }
  return changed.sort();
}

/**
 * The hash of a file's statements. Comments, blank lines, and trailing
 * whitespace do not count, so editing a comment in an applied file is safe.
 */
export function clickHouseMigrationHash(sql: string): string {
  return createHash("sha256").update(sqlStatements(sql).join(";\n")).digest("hex");
}

/**
 * A file's statements, without line comments, blank lines, or trailing
 * whitespace. A quoted string keeps its text as written, including `;`, `--`,
 * blank lines, and trailing whitespace: the hash is these statements, so this
 * split is part of an applied file's identity. Block comments are not
 * recognized.
 */
export function sqlStatements(sql: string): string[] {
  return splitOnSemicolons(stripCommentsAndBlankLines(sql))
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** `i` is the opening quote. Returns the index after the closing quote. */
function endOfQuote(sql: string, i: number): number {
  const quote = sql[i];
  for (i++; i < sql.length; i++) {
    // ClickHouse strings treat a backslash as an escape, including `\'`.
    if (quote === "'" && sql[i] === "\\" && sql[i + 1] !== undefined && sql[i + 1] !== "\n") {
      i++;
      continue;
    }
    // `''`, `""`, and doubled backticks are one escaped quote.
    if (sql[i] === quote && sql[i + 1] === quote) {
      i++;
      continue;
    }
    if (sql[i] === quote) return i + 1;
  }
  return sql.length;
}

/** Works on text outside quotes only. A quoted string can span lines. */
function stripCommentsAndBlankLines(sql: string): string {
  const lines: string[] = [];
  let line = "";
  const endLine = () => {
    const kept = line.trimEnd();
    if (kept) lines.push(kept);
    line = "";
  };
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      const end = endOfQuote(sql, i);
      line += sql.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i);
      if (newline === -1) break;
      endLine();
      i = newline;
      continue;
    }
    if (c === "\n") {
      endLine();
      continue;
    }
    line += c;
  }
  endLine();
  return lines.join("\n");
}

function splitOnSemicolons(sql: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      i = endOfQuote(sql, i) - 1;
      continue;
    }
    if (c === ";") {
      parts.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(sql.slice(start));
  return parts;
}
