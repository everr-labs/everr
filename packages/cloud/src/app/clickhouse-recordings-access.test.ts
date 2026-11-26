import { sqlStatements } from "@everr/app/db/clickhouse-sql";
import { SQL_API_WITHHELD_COLUMNS } from "@everr/app/lib/sql-api-tables";
import { describe, expect, it } from "vite-plus/test";
import { cloudClickHouseMigrations } from "./clickhouse-migration-files";

const recordingsAccess = () => {
  const found = cloudClickHouseMigrations.find(({ name }) => name === "0017-recordings-rls.sql");
  if (!found) throw new Error("missing migration 0017-recordings-rls.sql");
  return sqlStatements(found.sql).map((statement) => statement.replace(/\s+/g, " "));
};

describe("Cloud SQL API access to recordings", () => {
  it("grants the table, then revokes exactly the withheld columns", () => {
    expect(
      recordingsAccess().filter((statement) =>
        /^(GRANT|REVOKE) .* app\.recordings /.test(statement),
      ),
    ).toEqual([
      "GRANT SELECT ON app.recordings TO sql_api_role",
      `REVOKE SELECT(${SQL_API_WITHHELD_COLUMNS.recordings.join(", ")}) ON app.recordings FROM sql_api_role`,
    ]);
  });

  it("denies by default before the grant", () => {
    const statements = recordingsAccess();
    const deny = statements.findIndex((s) =>
      /^CREATE ROW POLICY .*sql_api_default_deny_recordings/.test(s),
    );
    const grant = statements.findIndex((s) => s.startsWith("GRANT SELECT ON app.recordings"));

    expect(deny).toBeGreaterThanOrEqual(0);
    expect(deny).toBeLessThan(grant);
  });

  it("never grants a column list", () => {
    for (const { name, sql } of cloudClickHouseMigrations) {
      expect(sql, name).not.toMatch(/GRANT SELECT\s*\(/);
    }
  });
});
