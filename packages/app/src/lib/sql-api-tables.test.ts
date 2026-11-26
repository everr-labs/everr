import { describe, expect, it } from "vite-plus/test";
import { sharedClickHouseMigrations, sqlStatements } from "#app/db/clickhouse-sql.ts";
import { SQL_API_TABLES, SQL_API_WITHHELD_COLUMNS } from "./sql-api-tables";

const migration = (name: string) => {
  const found = sharedClickHouseMigrations.find((file) => file.name === name);
  if (!found) throw new Error(`missing migration ${name}`);
  return found.sql;
};

function tableColumns(sql: string, table: string): string[] {
  const create = sqlStatements(sql).find((statement) =>
    statement.startsWith(`CREATE TABLE IF NOT EXISTS app.${table}\n`),
  );
  if (!create) throw new Error(`no CREATE TABLE for ${table}`);
  const body = create.slice(create.indexOf("(") + 1, create.indexOf("\nENGINE"));
  return [...body.matchAll(/^ {4}(\w+) /gm)].map((match) => match[1]);
}

describe("SQL API withheld columns", () => {
  it("only names tables the role can read", () => {
    for (const table of Object.keys(SQL_API_WITHHELD_COLUMNS)) {
      expect(SQL_API_TABLES).toContain(table);
    }
  });

  it("withholds only columns the table has", () => {
    const all = tableColumns(migration("0016-create-recordings.sql"), "recordings");

    for (const column of SQL_API_WITHHELD_COLUMNS.recordings) expect(all).toContain(column);
  });
});
