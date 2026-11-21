import { describe, expect, it } from "vite-plus/test";
import {
  clickHouseMigrations,
  clickHouseMigrationsFor,
  sqlStatements,
} from "#app/db/clickhouse-sql.ts";
import {
  SQL_API_ROLE_SCOPED_TABLES,
  SQL_API_TABLES,
  SQL_API_WITHHELD_COLUMNS,
} from "./sql-api-tables";

const migration = (name: string) => {
  const found = clickHouseMigrations.find((file) => file.name === name);
  if (!found) throw new Error(`missing migration ${name}`);
  return found.sql;
};

// The GRANT and REVOKE statements of one product's file, in file order.
function accessStatements(name: string): string[] {
  return sqlStatements(migration(name))
    .map((statement) => statement.replace(/\s+/g, " "))
    .filter((statement) => /^(GRANT|REVOKE) .* app\.recordings /.test(statement));
}

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

  it.each(["0014-cloud-recordings-rls.sql", "0015-self-hosted-recordings-sql-api-grant.sql"])(
    "%s grants the table, then revokes exactly the withheld columns",
    (file) => {
      expect(accessStatements(file)).toEqual([
        "GRANT SELECT ON app.recordings TO sql_api_role",
        `REVOKE SELECT(${SQL_API_WITHHELD_COLUMNS.recordings.join(", ")}) ON app.recordings FROM sql_api_role`,
      ]);
    },
  );

  it("denies by default before the Cloud grant", () => {
    const statements = sqlStatements(migration("0014-cloud-recordings-rls.sql"));
    const deny = statements.findIndex((s) =>
      /^CREATE ROW POLICY .*sql_api_default_deny_recordings/s.test(s),
    );
    const grant = statements.findIndex((s) => s.startsWith("GRANT SELECT ON app.recordings"));

    expect(deny).toBeGreaterThanOrEqual(0);
    expect(deny).toBeLessThan(grant);
  });

  it("withholds only columns the table has", () => {
    const all = tableColumns(migration("0013-create-recordings.sql"), "recordings");

    for (const column of SQL_API_WITHHELD_COLUMNS.recordings) expect(all).toContain(column);
  });

  it("never grants a column list on recordings", () => {
    for (const { name, sql } of clickHouseMigrations) {
      expect(sql, name).not.toMatch(/GRANT SELECT\s*\(/);
    }
  });
});

describe("SQL API role scoped tables", () => {
  it.each(SQL_API_ROLE_SCOPED_TABLES)(
    "%s is readable and has one Cloud tenant policy for the whole role",
    (table) => {
      expect(SQL_API_TABLES).toContain(table);

      const policies = clickHouseMigrationsFor("cloud")
        .flatMap(({ sql }) => sqlStatements(sql))
        .map((statement) => statement.replace(/\s+/g, " "))
        .filter((statement) =>
          statement.startsWith(
            `CREATE ROW POLICY IF NOT EXISTS sql_api_tenant_${table} ON app.${table} FOR SELECT `,
          ),
        );

      expect(policies).toHaveLength(1);
      expect(policies[0]).toContain("tenant_id = substring(currentUser(), ");
      expect(policies[0]).toMatch(/ TO sql_api_role$/);
    },
  );
});
