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
  clickHouseMigrations,
  clickHouseMigrationsFor,
  clickHouseMigrationTarget,
  sqlStatements,
} from "./clickhouse-sql";

const migration = (name: string, sql = `SELECT '${name}'`): ClickHouseMigration => ({ name, sql });
const applied = (...migrations: ClickHouseMigration[]) =>
  new Map(migrations.map(({ name, sql }) => [name, clickHouseMigrationHash(sql)]));
const names = (list: readonly { name: string }[]) => list.map(({ name }) => name);

describe("ClickHouse migrations", () => {
  it("bundles the migration files", () => {
    expect(names(clickHouseMigrations)).toContain("0007-create-alert-events.sql");
  });

  it("gives every bundled file its own four-digit number", () => {
    const numbers = names(clickHouseMigrations).map((name) => /^(\d{4})-/.exec(name)?.[1]);

    expect(numbers).not.toContain(undefined);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives a product the untagged files and the ones tagged for it", () => {
    const files = [
      migration("0001-setup.sql"),
      migration("0015-cloud-role.sql"),
      migration("0015-self-hosted-role.sql"),
      migration("0012-cloud-apply-rls.sql"),
    ];

    expect(names(clickHouseMigrationsFor("self-hosted", files))).toEqual([
      "0001-setup.sql",
      "0015-self-hosted-role.sql",
    ]);
    expect(names(clickHouseMigrationsFor("cloud", files))).toEqual([
      "0001-setup.sql",
      "0015-cloud-role.sql",
      "0012-cloud-apply-rls.sql",
    ]);
    // The tag sits right after the number. The word elsewhere is not a tag.
    expect(clickHouseMigrationTarget("0030-create-cloud-usage.sql")).toBeUndefined();
  });

  it("keeps tenant row policies out of the self-hosted files", () => {
    const selfHosted = clickHouseMigrationsFor("self-hosted");

    expect(names(selfHosted.filter(({ sql }) => /^CREATE ROW POLICY/m.test(sql)))).toEqual([]);
    expect(names(clickHouseMigrationsFor("cloud"))).toContain("0012-cloud-apply-rls.sql");
  });

  it("orders migrations by file name and skips applied ones", () => {
    const pending = pendingClickHouseMigrations(
      [migration("0003-tables.sql"), migration("0015-role.sql"), migration("0001-setup.sql")],
      applied(migration("0003-tables.sql")),
    );

    expect(names(pending)).toEqual(["0001-setup.sql", "0015-role.sql"]);
  });

  it("rejects two files with one name, because the journal records names", () => {
    expect(() =>
      pendingClickHouseMigrations(
        [migration("0015-role.sql"), migration("0015-role.sql")],
        new Map(),
      ),
    ).toThrow("Duplicate ClickHouse migration 0015-role.sql");
  });

  it("stops before running anything when an applied file changed", () => {
    const before = migration("0003-tables.sql", "CREATE TABLE a (x UInt8)");
    const after = migration("0003-tables.sql", "CREATE TABLE a (x UInt16)");

    expect(() =>
      pendingClickHouseMigrations([after, migration("0004-new.sql")], applied(before)),
    ).toThrow("ClickHouse migrations changed after they were applied: 0003-tables.sql.");
  });

  it("treats a comment edit in an applied file as a change", () => {
    const before = migration("0003-tables.sql", "-- v1\nCREATE TABLE a (x UInt8);\n");
    const after = migration("0003-tables.sql", "-- v1, typo fixed\nCREATE TABLE a (x UInt8);\n");

    expect(() => pendingClickHouseMigrations([after], applied(before))).toThrow(
      "ClickHouse migrations changed after they were applied: 0003-tables.sql.",
    );
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
    const latest = [...clickHouseMigrations]
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

  it("gives a statement a stable query id so a retry cancels the previous run", () => {
    expect(clickHouseMigrationQueryId("0007-create-alert-events.sql", 0)).toBe(
      "everr-ch-0007-create-alert-events_sql-0",
    );
    expect(clickHouseMigrationQueryId("0007-create-alert-events.sql", 1)).toBe(
      "everr-ch-0007-create-alert-events_sql-1",
    );
  });

  it("treats an existing migration file as immutable and a new file as pending", () => {
    const path = "packages/app/clickhouse/0001-setup.sql";
    const base = new Map([[path, "-- old\nSELECT 1;"]]);
    const added = new Map([...base, ["packages/app/clickhouse/0002-next.sql", "SELECT 2;"]]);
    const commented = new Map([[path, "-- new\nSELECT 1;"]]);
    const edited = new Map([[path, "SELECT 3;"]]);
    const deleted = new Map<string, string>();

    expect(changedClickHouseMigrationFiles(base, added)).toEqual([]);
    expect(changedClickHouseMigrationFiles(base, commented)).toEqual([path]);
    expect(changedClickHouseMigrationFiles(base, edited)).toEqual([path]);
    expect(changedClickHouseMigrationFiles(base, deleted)).toEqual([path]);
    expect(isClickHouseMigrationPath(path)).toBe(true);
    expect(isClickHouseMigrationPath("packages/app/clickhouse/repeatable/01.sql")).toBe(false);
    expect(isClickHouseMigrationPath("packages/cloud/clickhouse/0020-apply-rls.sql")).toBe(false);
  });

  it("binds only the parameters a statement names", () => {
    expect(
      statementParams("0001-setup.sql", "CREATE USER {name:Identifier} BY {password:String}", {
        name: "sql_api",
        password: "secret",
        unused: "x",
      }),
    ).toEqual({ name: "sql_api", password: "secret" });
  });

  it("names the migration and parameter a statement is missing", () => {
    expect(() =>
      statementParams("0001-setup.sql", "CREATE USER a BY {password:String}", {}),
    ).toThrow("ClickHouse migration 0001-setup.sql needs the password parameter");
  });
});
