import { createHmac } from "node:crypto";
import { env } from "@/env";
import { createClient } from "@/lib/clickhouse-client";

const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

export type ClickhouseQuery = <T>(
  sql: string,
  params?: Record<string, unknown>,
) => Promise<T[]>;

export async function query<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: organizationId,
    },
  });

  return result.json<T>();
}

// Tables that get a per-org row policy provisioned. Must match the read tables
// granted to sql_api_role in clickhouse/init/15-create-sql-api-role.sql.
const SQL_API_TENANT_TABLES = [
  "traces",
  "logs",
  "metrics_gauge",
  "metrics_sum",
] as const;

function sqlApiOrgUserName(organizationId: string): string {
  return `sql_api_org_${organizationId}`;
}

function sqlApiOrgPassword(organizationId: string): string {
  return `${createHmac("sha256", env.CLICKHOUSE_SQL_API_MASTER_KEY)
    .update(organizationId, "utf8")
    .digest("hex")}A!`; // CH requires at least an uppercase and a special char
}

function sqlApiOrgPolicyName(organizationId: string, table: string): string {
  return `${sqlApiOrgUserName(organizationId)}_${table}`;
}

// Tenant context is the authenticated user, not a settable value: each org has
// its own ClickHouse user `sql_api_org_<id>` with a row policy bound directly
// to that user, so user SQL cannot override the tenant filter via SETTINGS or
// any other channel. The query authenticates with HMAC-derived credentials per
// query and reuses the shared `clickhouse` HTTP client.
export async function querySqlApi<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);

  const result = await clickhouse.query({
    query,
    query_params,
    format: "JSONEachRow",
    auth: { username, password },
    // Per-tenant quota bucket. sql_api_quota is KEYED BY client_key, so each
    // org gets its own counters. The header value is server-derived from
    // session.activeOrganizationId — never forwarded from CLI input.
    http_headers: { "X-ClickHouse-Quota": username },
  });

  return result.json<T>();
}

export function createClickhouseQuery(organizationId: string) {
  return async <T>(sql: string, params?: Record<string, unknown>) =>
    query<T>(sql, organizationId, params);
}

// web_app_admin client: holds all privileges the web-app process needs that
// go beyond app_ro's read-only access — writing per-tenant retention rows,
// and provisioning per-org access entities (users + row policies) for the
// /sql API. Grants are pinned in clickhouse/init/00-setup.sh.
const clickhouseAdmin = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_ADMIN_USERNAME,
  password: env.CLICKHOUSE_ADMIN_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

export async function upsertTenantRetention(row: {
  tenantId: string;
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
}): Promise<void> {
  await clickhouseAdmin.insert({
    table: "app.tenant_retention_source",
    values: [
      {
        tenant_id: row.tenantId,
        traces_days: row.tracesDays,
        logs_days: row.logsDays,
        metrics_days: row.metricsDays,
      },
    ],
    format: "JSONEachRow",
  });
}

// Create the per-org ClickHouse user, set its profile + default role, grant
// sql_api_role, and create the per-table row policies that pin the tenant id
// in as a constant.
export async function provisionSqlApiOrgUser(
  organizationId: string,
): Promise<void> {
  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);
  const tenantLiteral = `'${organizationId}'`;

  await clickhouseAdmin.command({
    query: `CREATE USER IF NOT EXISTS \`${username}\` IDENTIFIED WITH sha256_password BY '${password}' SETTINGS PROFILE 'sql_api_profile'`,
  });
  await clickhouseAdmin.command({
    query: `GRANT sql_api_role TO \`${username}\``,
  });
  // DEFAULT ROLE has to come after the GRANT — CH validates the role is
  // already granted to the user before it can be the default.
  await clickhouseAdmin.command({
    query: `ALTER USER \`${username}\` DEFAULT ROLE sql_api_role`,
  });

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await clickhouseAdmin.command({
      query: `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = ${tenantLiteral} TO \`${username}\``,
    });
  }
}

// Reverse of provisionSqlApiOrgUser. Order is important: drop the policies
// before the user so DROP USER doesn't fail with "user is referenced".
export async function deprovisionSqlApiOrgUser(
  organizationId: string,
): Promise<void> {
  const username = sqlApiOrgUserName(organizationId);

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await clickhouseAdmin.command({
      query: `DROP ROW POLICY IF EXISTS \`${policy}\` ON app.\`${table}\``,
    });
  }

  await clickhouseAdmin.command({
    query: `DROP USER IF EXISTS \`${username}\``,
  });
}
