import type { ClickHouseSeed } from "../src/db/clickhouse-sql.ts";
import {
  createSqlApiOrgPolicy,
  SQL_API_ORG_USER_PREFIX,
  sqlApiOrgIdFromUserName,
} from "../src/lib/sql-api-org-users.ts";

// The organizations to cover are the SQL API users ClickHouse already has.
// Provisioning creates the user before any policy, so the list holds every
// organization that can query, and none that was deprovisioned.
const seed: ClickHouseSeed = async ({ query, command }) => {
  const users = await query<{ name: string }>(
    `SELECT name FROM system.users WHERE startsWith(name, '${SQL_API_ORG_USER_PREFIX}') ORDER BY name`,
  );
  for (const { name } of users) {
    const organizationId = sqlApiOrgIdFromUserName(name);
    if (organizationId === undefined) continue;
    await command(createSqlApiOrgPolicy(organizationId, "recordings"));
  }
};

export default seed;
