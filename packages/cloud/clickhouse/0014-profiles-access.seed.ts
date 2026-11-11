import type { ClickHouseSeed } from "@everr/app/db/clickhouse-sql";

// Organizations provisioned before profiles joined SQL_API_TABLES have no
// profiles policy, so the default-deny policy hides every profile row from
// them. Same statement as provisionSqlApiOrgUser in src/clickhouse/provisioning.ts.
const USER_PREFIX = "sql_api_org_";
// Row policy DDL takes no parameters, so the id goes into the SQL text. It
// must match the pattern provisioning enforces on organization ids.
const ORGANIZATION_ID = /^[A-Za-z0-9_-]+$/;

const seed: ClickHouseSeed = async ({ query, command }) => {
  const users = await query<{ name: string }>(
    "SELECT name FROM system.users WHERE startsWith(name, {prefix:String}) ORDER BY name",
    { prefix: USER_PREFIX },
  );
  for (const { name } of users) {
    const organizationId = name.slice(USER_PREFIX.length);
    if (!ORGANIZATION_ID.test(organizationId)) {
      throw new Error(`Unexpected SQL API user name: ${JSON.stringify(name)}`);
    }
    await command(
      `CREATE ROW POLICY IF NOT EXISTS \`${name}_profiles\` ON app.\`profiles\` FOR SELECT USING tenant_id = '${organizationId}' TO \`${name}\``,
    );
  }
};

export default seed;
