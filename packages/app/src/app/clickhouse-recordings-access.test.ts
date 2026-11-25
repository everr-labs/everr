import { describe, expect, it } from "vite-plus/test";
import { sqlStatements } from "#app/db/clickhouse-sql.ts";
import { SQL_API_WITHHELD_COLUMNS } from "#app/lib/sql-api-tables.ts";
import { selfHostedClickHouseMigrations } from "./clickhouse-migration-files";

describe("Self-hosted SQL API access to recordings", () => {
  it("grants the table, then revokes exactly the withheld columns", () => {
    const found = selfHostedClickHouseMigrations.find(
      ({ name }) => name === "0018-recordings-sql-api-grant.sql",
    );
    if (!found) throw new Error("missing migration 0018-recordings-sql-api-grant.sql");

    expect(
      sqlStatements(found.sql)
        .map((statement) => statement.replace(/\s+/g, " "))
        .filter((statement) => /^(GRANT|REVOKE) .* app\.recordings /.test(statement)),
    ).toEqual([
      "GRANT SELECT ON app.recordings TO sql_api_role",
      `REVOKE SELECT(${SQL_API_WITHHELD_COLUMNS.recordings.join(", ")}) ON app.recordings FROM sql_api_role`,
    ]);
  });

  it("never grants a column list", () => {
    for (const { name, sql } of selfHostedClickHouseMigrations) {
      expect(sql, name).not.toMatch(/GRANT SELECT\s*\(/);
    }
  });
});
