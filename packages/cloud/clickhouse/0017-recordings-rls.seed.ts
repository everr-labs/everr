import type { ClickHouseSeed } from "@everr/app/db/clickhouse-sql";

// The default-deny policy in 0017 leaves an SQL API user without its own
// recordings policy at zero rows. Provisioning writes that policy for each
// organization it creates from now on. This seed writes it for the ones that
// exist when 0017 runs: the SQL API users ClickHouse already has. Provisioning
// creates the user before any policy, so the list holds every organization
// that can query, and none that was deprovisioned.
//
// The names and the statement copy what provisioning wrote when 0017 was
// added, because a seed must not change when provisioning does.
const USER_PREFIX = "sql_api_org_";
// CREATE ROW POLICY takes no parameters, so the id goes into the statement,
// and only an id that provisioning would accept gets there.
const ORG_ID = /^[A-Za-z0-9_-]+$/;

const seed: ClickHouseSeed = async ({ query, command }) => {
  const users = await query<{ name: string }>(
    "SELECT name FROM system.users WHERE startsWith(name, {prefix:String}) ORDER BY name",
    { prefix: USER_PREFIX },
  );
  for (const { name } of users) {
    const organizationId = name.slice(USER_PREFIX.length);
    if (!ORG_ID.test(organizationId)) continue;
    await command(
      `CREATE ROW POLICY IF NOT EXISTS \`${name}_recordings\` ON app.\`recordings\` FOR SELECT USING tenant_id = '${organizationId}' TO \`${name}\``,
    );
  }
};

export default seed;
