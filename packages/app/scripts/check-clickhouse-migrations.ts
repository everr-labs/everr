import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changedClickHouseMigrationFiles,
  CLICKHOUSE_MIGRATION_DIR,
  isClickHouseMigrationPath,
  lateClickHouseSeedFiles,
} from "../src/db/clickhouse-statements.ts";

// Fails the pull request when a ClickHouse migration that already exists on
// the base branch changes or disappears. A comment edit is a change. New
// files pass. Startup repeats the check against the journal. It also fails
// when a seed is added to a migration the base branch already has: the
// seed would never run where that migration is applied.
const ref = process.argv[2];
if (!ref) {
  console.error("Usage: check-clickhouse-migrations.ts <git-ref>");
  process.exit(2);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function git(args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

const listed = git(["ls-tree", "-r", "--name-only", ref, "--", CLICKHOUSE_MIGRATION_DIR]);
const base = new Map<string, string>();
for (const path of listed.split("\n")) {
  if (!isClickHouseMigrationPath(path)) continue;
  base.set(path, git(["show", `${ref}:${path}`]));
}

const head = new Map<string, string>();
for (const path of base.keys()) {
  const full = resolve(root, path);
  if (!existsSync(full)) continue;
  head.set(path, readFileSync(full, "utf8"));
}

const indented = (paths: readonly string[]) => paths.map((path) => `  ${path}`).join("\n");
let failed = false;

const changed = changedClickHouseMigrationFiles(base, head);
if (changed.length > 0) {
  failed = true;
  console.error(
    `ClickHouse migrations changed after they were committed:\n${indented(changed)}\nApplied migrations are immutable: restore them and put the change in a new file.`,
  );
}

const late = lateClickHouseSeedFiles(
  new Set(listed.split("\n")),
  readdirSync(resolve(root, CLICKHOUSE_MIGRATION_DIR)).map(
    (name) => `${CLICKHOUSE_MIGRATION_DIR}/${name}`,
  ),
);
if (late.length > 0) {
  failed = true;
  console.error(
    `ClickHouse seeds added to migrations that are already committed:\n${indented(late)}\nA seed runs once, with its migration: put it next to a new migration file.`,
  );
}

process.exit(failed ? 1 : 0);
