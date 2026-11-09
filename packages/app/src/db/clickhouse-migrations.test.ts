// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
  clickHouseMigrationHash,
  clickHouseMigrationPlan,
  statementParams,
} from "./clickhouse-migrations";
import {
  type ClickHouseMigration,
  sharedClickHouseMigrations,
  sqlStatements,
} from "./clickhouse-sql";

const migration = (
  name: string,
  { kind = "versioned", sql = `SELECT '${name}'` }: Partial<ClickHouseMigration> = {},
): ClickHouseMigration => ({ name, kind, sql });
const applied = (...migrations: ClickHouseMigration[]) =>
  new Map(migrations.map(({ name, sql }) => [name, clickHouseMigrationHash(sql)]));
const names = (list: readonly { name: string }[]) => list.map(({ name }) => name);

describe("ClickHouse migrations", () => {
  it("bundles the shared schema files", () => {
    expect(sharedClickHouseMigrations.map(({ name }) => name)).toContain(
      "12-create-alert-events.sql",
    );
  });

  it("marks the files under repeatable/ as repeatable", () => {
    const kinds = new Map(sharedClickHouseMigrations.map(({ name, kind }) => [name, kind]));
    expect(kinds.get("04-create-error-fingerprint-function.sql")).toBe("repeatable");
    expect(kinds.get("03-create-otel-tables.sql")).toBe("versioned");
  });

  it("orders migrations from every directory by file name and skips applied ones", () => {
    const plan = clickHouseMigrationPlan(
      [migration("03-tables.sql"), migration("15-role.sql"), migration("00-setup.sql")],
      applied(migration("03-tables.sql")),
    );

    expect(names(plan.run)).toEqual(["00-setup.sql", "15-role.sql"]);
  });

  it("rejects two files with one name, because the journal records names", () => {
    expect(() =>
      clickHouseMigrationPlan([migration("15-role.sql"), migration("15-role.sql")], new Map()),
    ).toThrow("Duplicate ClickHouse migration 15-role.sql");
  });

  it("stops before running anything when an applied versioned file changed", () => {
    const before = migration("03-tables.sql", { sql: "CREATE TABLE a (x UInt8)" });
    const after = migration("03-tables.sql", { sql: "CREATE TABLE a (x UInt16)" });

    expect(() =>
      clickHouseMigrationPlan([after, migration("04-new.sql")], applied(before)),
    ).toThrow("ClickHouse migrations changed after they were applied: 03-tables.sql.");
  });

  it("runs a repeatable file again when its statements change", () => {
    const before = migration("04-fn.sql", {
      kind: "repeatable",
      sql: "CREATE OR REPLACE FUNCTION f AS () -> 1",
    });
    const after = migration("04-fn.sql", {
      kind: "repeatable",
      sql: "CREATE OR REPLACE FUNCTION f AS () -> 2",
    });

    expect(names(clickHouseMigrationPlan([before], applied(before)).run)).toEqual([]);
    expect(names(clickHouseMigrationPlan([after], applied(before)).run)).toEqual(["04-fn.sql"]);
  });

  it("ignores comment and whitespace changes in an applied file", () => {
    const before = migration("03-tables.sql", { sql: "-- v1\nCREATE TABLE a (x UInt8);\n" });
    const after = migration("03-tables.sql", {
      sql: "-- v1, typo fixed\n\nCREATE TABLE a (x UInt8);",
    });

    expect(clickHouseMigrationPlan([after], applied(before)).run).toEqual([]);
  });

  it("records the hash of files applied before the journal stored hashes", () => {
    const plan = clickHouseMigrationPlan(
      [migration("03-tables.sql"), migration("04-fn.sql", { kind: "repeatable" })],
      new Map([
        ["03-tables.sql", ""],
        ["04-fn.sql", ""],
      ]),
    );

    expect(names(plan.record)).toEqual(["03-tables.sql"]);
    expect(names(plan.run)).toEqual(["04-fn.sql"]);
  });

  it("reports journal entries this build does not bundle", () => {
    const plan = clickHouseMigrationPlan(
      [migration("03-tables.sql")],
      applied(migration("03-tables.sql"), migration("99-newer.sql")),
    );

    expect(plan.unknown).toEqual(["99-newer.sql"]);
  });

  it("gives the local collector's chDB the same errorFingerprint as App and Cloud", () => {
    const collectorCopy = readFileSync(
      new URL(
        "../../../../collector/exporter/chdbexporter/internal/sqltemplates/create_error_fingerprint_function.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const shared = sharedClickHouseMigrations.find(
      ({ name }) => name === "04-create-error-fingerprint-function.sql",
    );

    expect(sqlStatements(collectorCopy)).toEqual(sqlStatements(shared?.sql ?? ""));
  });

  it("splits statements after removing comments that contain semicolons", () => {
    expect(sqlStatements("-- one; two\nCREATE ROLE a;\n\nGRANT b TO a; -- done;\n")).toEqual([
      "CREATE ROLE a",
      "GRANT b TO a",
    ]);
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
