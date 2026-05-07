import { createClient } from "@clickhouse/client";
import { env } from "@/env";

export const clickhouse = createClient({
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

// Org IDs are session-derived (better-auth nanoid-style), but the provisioner
// builds DDL by string concat, so guard against any non-conforming value
// reaching ClickHouse identifiers.
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeOrgId(organizationId: string): void {
  if (!ORG_ID_PATTERN.test(organizationId)) {
    throw new Error(`Unsafe organization id for ClickHouse: ${organizationId}`);
  }
}

function sqlApiOrgRoleName(organizationId: string): string {
  return `sql_api_org_${organizationId}`;
}

function sqlApiOrgPolicyName(organizationId: string, table: string): string {
  return `sql_api_org_${organizationId}_${table}`;
}

// Dedicated client for the /sql API. Connects as sql_api_user, whose
// sql_api_role/sql_api_profile/sql_api_quota enforce all readonly + resource
// caps server-side. The app does not inject any per-query SETTINGS here.
const clickhouseSqlApi = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_SQL_API_USERNAME,
  password: env.CLICKHOUSE_SQL_API_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

// Tenant context is the active role set on the connection, not a settable
// value: the per-org role's row policy bakes the tenant id in as a constant,
// so user SQL cannot override it via SETTINGS or any other channel. The app
// activates exactly two roles per query — `sql_api_role` (grants + caps) plus
// the org-specific role (tenant filter). DEFAULT ROLE NONE on sql_api_user
// guarantees a missing role= param fails closed.
export async function querySqlApi<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }
  assertSafeOrgId(organizationId);

  const result = await clickhouseSqlApi.query({
    query,
    query_params,
    format: "JSONEachRow",
    role: ["sql_api_role", sqlApiOrgRoleName(organizationId)],
  });

  return result.json<T>();
}

export function createClickhouseQuery(organizationId: string) {
  return async <T>(sql: string, params?: Record<string, unknown>) =>
    query<T>(sql, organizationId, params);
}

// web_app_admin client: holds all privileges the web-app process needs that
// go beyond app_ro's read-only access — writing per-tenant retention rows,
// and provisioning per-org access entities (roles + row policies) for the
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

// Create the per-org role, the per-table row policies that pin the tenant id
// in as a constant, and grant the role to sql_api_user. Idempotent: safe to
// call repeatedly (e.g. in a backfill or after a transient failure).
export async function provisionSqlApiOrgRole(
  organizationId: string,
): Promise<void> {
  assertSafeOrgId(organizationId);
  const role = sqlApiOrgRoleName(organizationId);
  const tenantLiteral = `'${organizationId}'`; // org id pre-validated above

  await clickhouseAdmin.command({
    query: `CREATE ROLE IF NOT EXISTS \`${role}\``,
  });

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await clickhouseAdmin.command({
      query: `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = ${tenantLiteral} TO \`${role}\``,
    });
  }

  await clickhouseAdmin.command({
    query: `GRANT \`${role}\` TO sql_api_user`,
  });
}

// Reverse of provisionSqlApiOrgRole. Order is important: drop the policies
// before the role so DROP ROLE doesn't fail with "role is referenced".
export async function deprovisionSqlApiOrgRole(
  organizationId: string,
): Promise<void> {
  assertSafeOrgId(organizationId);
  const role = sqlApiOrgRoleName(organizationId);

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await clickhouseAdmin.command({
      query: `DROP ROW POLICY IF EXISTS \`${policy}\` ON app.\`${table}\``,
    });
  }

  await clickhouseAdmin.command({
    query: `DROP ROLE IF EXISTS \`${role}\``,
  });
}
