import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { sqlStatements } from "#app/db/clickhouse-sql.ts";
import { isAccessControl } from "#app/testing/chdb-migrated-store.ts";
import { selfHostedClickHouseMigrations } from "./clickhouse-migration-files.ts";

const names = selfHostedClickHouseMigrations.map(({ name }) => name);
// The local store creates its own databases, as a deployment does for a
// server, so this file has no hosted counterpart.
const LOCAL_SETUP = "0001-setup.sql";

describe("self-hosted ClickHouse migrations", () => {
  it("applies the shared files and its own", () => {
    expect(names).toEqual(
      expect.arrayContaining(["0007-create-alert-events.sql", "0011-grant-sql-api-user.sql"]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves the databases and users to the deployment", () => {
    const creates = selfHostedClickHouseMigrations.filter(({ sql }) =>
      /^\s*CREATE\s+(DATABASE|USER)\b/im.test(sql),
    );

    expect(creates.map(({ name }) => name)).toEqual([]);
  });

  it("has no tenant row policies", () => {
    const policies = selfHostedClickHouseMigrations.filter(({ sql }) =>
      /^CREATE ROW POLICY/m.test(sql),
    );

    expect(policies.map(({ name }) => name)).toEqual([]);
  });

  it("keeps the local store's files equal to these, without access control", () => {
    const localDir = new URL("../../../../collector/localcollector/migrations/", import.meta.url);
    const local = Object.fromEntries(
      readdirSync(localDir)
        .filter((name) => name.endsWith(".sql") && name !== LOCAL_SETUP)
        .map((name) => [name, sqlStatements(readFileSync(new URL(name, localDir), "utf8"))]),
    );
    // chDB has one implicit user, so the local store has no copy of a file
    // that holds only access control.
    const expected = Object.fromEntries(
      selfHostedClickHouseMigrations
        .map(({ name, sql }) => [
          name,
          sqlStatements(sql).filter((statement) => !isAccessControl(statement)),
        ])
        .filter(([, statements]) => statements.length > 0),
    );

    expect(local).toEqual(expected);
  });
});
