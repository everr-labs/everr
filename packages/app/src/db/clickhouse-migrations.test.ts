// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import {
  pendingClickHouseMigrations,
  sharedClickHouseMigrations,
  sqlStatements,
  statementParams,
} from "./clickhouse-migrations";

const migration = (name: string) => ({ name, sql: `SELECT '${name}'` });

describe("ClickHouse migrations", () => {
  it("bundles the shared schema files", () => {
    expect(sharedClickHouseMigrations.map(({ name }) => name)).toContain(
      "12-create-alert-events.sql",
    );
  });

  it("orders migrations from every directory by file name and skips applied ones", () => {
    const pending = pendingClickHouseMigrations(
      [migration("03-tables.sql"), migration("15-role.sql"), migration("00-setup.sql")],
      new Set(["03-tables.sql"]),
    );

    expect(pending.map(({ name }) => name)).toEqual(["00-setup.sql", "15-role.sql"]);
  });

  it("rejects two files with one name, because the journal records names", () => {
    expect(() =>
      pendingClickHouseMigrations([migration("15-role.sql"), migration("15-role.sql")], new Set()),
    ).toThrow("Duplicate ClickHouse migration 15-role.sql");
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
