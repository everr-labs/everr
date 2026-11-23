import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "chdb";

import {
  byMigrationName,
  clickHouseMigrations,
  clickHouseMigrationTarget,
  sqlStatements,
} from "#app/db/clickhouse-sql.ts";

// Embedded chDB has no access management, so every statement that creates or
// grants access is skipped. These tests do not verify tenant isolation.
export function isAccessControl(statement: string): boolean {
  return /^\s*(GRANT|REVOKE|SET\s+(DEFAULT\s+)?ROLE|(CREATE|ALTER|DROP)\s+(USER|ROLE|(ROW\s+)?POLICY|(SETTINGS\s+)?PROFILE|QUOTA))\b/i.test(
    statement,
  );
}

export function withoutTtl(statement: string): string {
  return statement.replace(/\nTTL [\s\S]*?(?=\nSETTINGS )/, "\n");
}

export interface MigratedChdbStore {
  run(sql: string): string;
  close(): void;
}

/**
 * A chDB session on a temp directory holding the schema both products share:
 * the untagged migrations, with `app` as the current database.
 */
export function openMigratedChdbStore(prefix: string): MigratedChdbStore {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const session = new Session(dataDir);
  const run = (sql: string) => String(session.query(sql, "JSONEachRow") ?? "").trim();

  const shared = clickHouseMigrations
    .filter(({ name }) => clickHouseMigrationTarget(name) === undefined)
    .sort(byMigrationName);
  for (const { sql } of shared) {
    for (const statement of sqlStatements(sql)) {
      if (!isAccessControl(statement)) run(withoutTtl(statement));
    }
  }
  run("USE app");

  return {
    run,
    close() {
      session.cleanup();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
