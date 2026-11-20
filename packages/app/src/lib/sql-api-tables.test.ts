import { describe, expect, it } from "vite-plus/test";
import { clickHouseMigrations, sqlStatements } from "#app/db/clickhouse-sql.ts";
import { SQL_API_TABLE_COLUMNS, SQL_API_TABLES } from "./sql-api-tables";

const migration = (name: string) => {
  const found = clickHouseMigrations.find((file) => file.name === name);
  if (!found) throw new Error(`missing migration ${name}`);
  return found.sql;
};

const GRANT = /^GRANT SELECT\(([^)]*)\) ON app\.(\w+) TO sql_api_role$/;

function columnGrants(name: string): Map<string, string[]> {
  const grants = new Map<string, string[]>();
  for (const statement of sqlStatements(migration(name))) {
    const match = GRANT.exec(statement.replace(/\s+/g, " "));
    if (match)
      grants.set(
        match[2],
        match[1].split(",").map((column) => column.trim()),
      );
  }
  return grants;
}

function tableColumns(sql: string, table: string): string[] {
  const create = sqlStatements(sql).find((statement) =>
    statement.startsWith(`CREATE TABLE IF NOT EXISTS app.${table}\n`),
  );
  if (!create) throw new Error(`no CREATE TABLE for ${table}`);
  const body = create.slice(create.indexOf("(") + 1, create.indexOf("\nENGINE"));
  return [...body.matchAll(/^ {4}(\w+) /gm)].map((match) => match[1]);
}

describe("SQL API column allowlist", () => {
  it("only names tables the role can read", () => {
    for (const table of Object.keys(SQL_API_TABLE_COLUMNS)) {
      expect(SQL_API_TABLES).toContain(table);
    }
  });

  it.each(["0014-cloud-recordings-rls.sql", "0015-self-hosted-recordings-sql-api-grant.sql"])(
    "is exactly what %s grants",
    (file) => {
      expect(columnGrants(file).get("recordings")).toEqual([...SQL_API_TABLE_COLUMNS.recordings]);
    },
  );

  it("is every column of app.recordings except Body", () => {
    const all = tableColumns(migration("0013-create-recordings.sql"), "recordings");

    expect(all).toContain("Body");
    expect([...SQL_API_TABLE_COLUMNS.recordings].sort()).toEqual(
      all.filter((column) => column !== "Body").sort(),
    );
  });

  it("never gives the role a whole-table grant on recordings", () => {
    for (const { name, sql } of clickHouseMigrations) {
      expect(sql, name).not.toMatch(/GRANT SELECT ON app\.recordings\b/);
    }
  });
});
