// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
  clickHouseMigrationHash,
  clickHouseMigrationQueryId,
  pendingClickHouseMigrations,
  statementParams,
} from "./clickhouse-migrations";
import {
  changedClickHouseMigrationFiles,
  isClickHouseMigrationPath,
} from "./clickhouse-statements";
import {
  byMigrationName,
  type ClickHouseMigration,
  sharedClickHouseMigrations,
  sqlStatements,
} from "./clickhouse-sql";

const migration = (name: string, sql = `SELECT '${name}'`): ClickHouseMigration => ({ name, sql });
const applied = (...migrations: ClickHouseMigration[]) =>
  new Map(migrations.map(({ name, sql }) => [name, clickHouseMigrationHash(sql)]));
const names = (list: readonly { name: string }[]) => list.map(({ name }) => name);

describe("ClickHouse migrations", () => {
  it("bundles the shared schema files", () => {
    expect(names(sharedClickHouseMigrations)).toContain("12-create-alert-events.sql");
  });

  it("orders migrations from every directory by file name and skips applied ones", () => {
    const pending = pendingClickHouseMigrations(
      [migration("03-tables.sql"), migration("15-role.sql"), migration("00-setup.sql")],
      applied(migration("03-tables.sql")),
    );

    expect(names(pending)).toEqual(["00-setup.sql", "15-role.sql"]);
  });

  it("rejects two files with one name, because the journal records names", () => {
    expect(() =>
      pendingClickHouseMigrations([migration("15-role.sql"), migration("15-role.sql")], new Map()),
    ).toThrow("Duplicate ClickHouse migration 15-role.sql");
  });

  it("stops before running anything when an applied file changed", () => {
    const before = migration("03-tables.sql", "CREATE TABLE a (x UInt8)");
    const after = migration("03-tables.sql", "CREATE TABLE a (x UInt16)");

    expect(() =>
      pendingClickHouseMigrations([after, migration("04-new.sql")], applied(before)),
    ).toThrow("ClickHouse migrations changed after they were applied: 03-tables.sql.");
  });

  it("ignores comment and whitespace changes in an applied file", () => {
    const before = migration("03-tables.sql", "-- v1\nCREATE TABLE a (x UInt8);\n");
    const after = migration("03-tables.sql", "-- v1, typo fixed\n\nCREATE TABLE a (x UInt8);");

    expect(pendingClickHouseMigrations([after], applied(before))).toEqual([]);
  });

  it("ignores comments added or removed inside a statement", () => {
    const before = migration("03-tables.sql", "CREATE TABLE a (\n  x UInt8, -- old\n  y UInt8\n);");
    const after = migration(
      "03-tables.sql",
      "CREATE TABLE a (\n  -- the key\n  x UInt8,\n\n  y UInt8\n);",
    );

    expect(pendingClickHouseMigrations([after], applied(before))).toEqual([]);
  });

  it("gives the local collector's chDB the same errorFingerprint as App and Cloud", () => {
    const collectorCopy = readFileSync(
      new URL(
        "../../../../collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const definitions = (sql: string) =>
      sqlStatements(sql).filter((statement) =>
        /^CREATE (OR REPLACE )?FUNCTION (IF NOT EXISTS )?errorFingerprint\b/.test(statement),
      );
    // A change to the function lands in a new file, so compare the latest definition.
    const latest = [...sharedClickHouseMigrations]
      .sort(byMigrationName)
      .flatMap(({ sql }) => definitions(sql))
      .at(-1);

    expect(latest).toBeDefined();
    expect(definitions(collectorCopy)).toEqual([latest]);
  });

  it("splits statements after removing comments that contain semicolons", () => {
    expect(sqlStatements("-- one; two\nCREATE ROLE a;\n\nGRANT b TO a; -- done;\n")).toEqual([
      "CREATE ROLE a",
      "GRANT b TO a",
    ]);
  });

  it("keeps semicolons and line comments that sit inside quotes", () => {
    expect(sqlStatements("SELECT 'a; b -- c';\nSELECT 1; -- trailing;\n")).toEqual([
      "SELECT 'a; b -- c'",
      "SELECT 1",
    ]);
    expect(sqlStatements("SELECT 'it''s; fine';\nSELECT 'a\\';b';")).toEqual([
      "SELECT 'it''s; fine'",
      "SELECT 'a\\';b'",
    ]);
    expect(sqlStatements("ALTER TABLE t MODIFY COLUMN `a; b` UInt8; SELECT 1;")).toEqual([
      "ALTER TABLE t MODIFY COLUMN `a; b` UInt8",
      "SELECT 1",
    ]);
    expect(sqlStatements('SELECT "a; b"; SELECT 2;')).toEqual(['SELECT "a; b"', "SELECT 2"]);
  });

  it("keeps blank lines and trailing whitespace that sit inside quotes", () => {
    const sql = "SELECT 'a  \n\n  b';  \n\nSELECT 1;";

    expect(sqlStatements(sql)).toEqual(["SELECT 'a  \n\n  b'", "SELECT 1"]);
    expect(clickHouseMigrationHash(sql)).not.toBe(
      clickHouseMigrationHash("SELECT 'a\n  b';\nSELECT 1;"),
    );
  });

  it("gives a statement a stable query id so a retry cancels the previous run", () => {
    expect(clickHouseMigrationQueryId("12-create-alert-events.sql", 0)).toBe(
      "everr-ch-12-create-alert-events_sql-0",
    );
    expect(clickHouseMigrationQueryId("12-create-alert-events.sql", 1)).toBe(
      "everr-ch-12-create-alert-events_sql-1",
    );
  });

  it("treats an existing migration file as immutable and a new file as pending", () => {
    const path = "packages/app/clickhouse/shared/01-setup.sql";
    const base = new Map([[path, "-- old\nSELECT 1;"]]);
    const commented = new Map([
      [path, "-- new\nSELECT 1;"],
      ["packages/app/clickhouse/shared/02-next.sql", "SELECT 2;"],
    ]);
    const edited = new Map([[path, "SELECT 3;"]]);
    const deleted = new Map<string, string>();

    expect(changedClickHouseMigrationFiles(base, commented)).toEqual([]);
    expect(changedClickHouseMigrationFiles(base, edited)).toEqual([path]);
    expect(changedClickHouseMigrationFiles(base, deleted)).toEqual([path]);
    expect(isClickHouseMigrationPath(path)).toBe(true);
    expect(isClickHouseMigrationPath("packages/app/clickhouse/shared/repeatable/01.sql")).toBe(
      false,
    );
    expect(isClickHouseMigrationPath("packages/cloud/clickhouse/20-apply-rls.sql")).toBe(true);
  });

  it("binds only the parameters a statement names", () => {
    expect(
      statementParams("00-setup.sql", "CREATE USER {name:Identifier} BY {password:String}", {
        name: "sql_api",
        password: "secret",
        unused: "x",
      }),
    ).toEqual({ name: "sql_api", password: "secret" });
  });

  it("names the migration and parameter a statement is missing", () => {
    expect(() => statementParams("00-setup.sql", "CREATE USER a BY {password:String}", {})).toThrow(
      "ClickHouse migration 00-setup.sql needs the password parameter",
    );
  });
});
