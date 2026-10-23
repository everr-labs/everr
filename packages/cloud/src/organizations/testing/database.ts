import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { organizationMilestones } from "../../db/schema/organization-milestones";

/** Materialize current schema source only in a disposable test DB, never application migrations. */
export async function createMilestoneTestTable(client: { exec(sql: string): Promise<unknown> }) {
  const config = getTableConfig(organizationMilestones);
  const dialect = new PgDialect();
  const columns = config.columns.map(
    (column) => `"${column.name}" ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}`,
  );
  const checks = config.checks.map(
    (check) => `CONSTRAINT "${check.name}" CHECK (${dialect.sqlToQuery(check.value).sql})`,
  );
  await client.exec(
    `CREATE TABLE organization_milestones (${[
      ...columns,
      ...checks,
      "PRIMARY KEY (organization_id)",
      "FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE",
    ].join(",")})`,
  );
}
