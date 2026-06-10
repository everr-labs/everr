import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/env";
import { createClient } from "@/lib/clickhouse-client";
import { instrumentClickhouseOperation } from "@/telemetry/clickhouse";

// The client default of 2500ms forces a fresh TLS handshake on most queries
// against ClickHouse Cloud (server keep-alive ~10s). Set just under the server
// timeout so idle sockets are reused instead of reconnected.
const clickhouseKeepAlive = { idle_socket_ttl: 8000 } as const;

const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  keep_alive: clickhouseKeepAlive,
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

  const result = await instrumentClickhouseOperation(
    { client: "app", operation: "QUERY" },
    () =>
      clickhouse.query({
        query,
        query_params,
        format: "JSONEachRow",
        clickhouse_settings: {
          SQL_everr_tenant_id: organizationId,
        },
      }),
  );

  return result.json<T>();
}

// Tables that get a per-org row policy provisioned. Must match the read tables
// granted to sql_api_role in clickhouse/init/15-create-sql-api-role.sql.
const SQL_API_TENANT_TABLES = [
  "traces",
  "logs",
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
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

  const result = await instrumentClickhouseOperation(
    { client: "sql_api", operation: "QUERY" },
    () =>
      clickhouse.query({
        query,
        query_params,
        format: "JSONEachRow",
        auth: { username, password },
        // Per-tenant quota bucket. sql_api_quota is KEYED BY client_key, so each
        // org gets its own counters. The header value is server-derived from
        // session.activeOrganizationId — never forwarded from CLI input.
        http_headers: { "X-ClickHouse-Quota": username },
      }),
  );

  return result.json<T>();
}

export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
}

export async function querySqlApiWithMeta<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<SqlApiResult<T>> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);

  const result = await instrumentClickhouseOperation(
    { client: "sql_api", operation: "QUERY" },
    () =>
      clickhouse.query({
        query,
        query_params,
        format: "JSON",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Quota": username },
      }),
  );

  const body = (await result.json()) as {
    meta?: { name: string }[];
    data?: T[];
  };
  return {
    rows: body.data ?? [],
    columns: (body.meta ?? []).map((m) => m.name),
  };
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
  keep_alive: clickhouseKeepAlive,
});

type AdminCommandOptions = Omit<
  Parameters<typeof clickhouseAdmin.command>[0],
  "query"
>;

export async function upsertTenantRetention(row: {
  tenantId: string;
  tracesDays: number;
  logsDays: number;
  metricsDays: number;
}): Promise<void> {
  await instrumentClickhouseOperation(
    { client: "admin", operation: "INSERT" },
    () =>
      clickhouseAdmin.insert({
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
      }),
  );
}

export interface AlertEventRow {
  organization_id: string;
  alert_definition_id: string;
  repoid: string;
  slug: string;
  event_type: "firing" | "resolved" | "evaluation_failed" | "delivery_attempt";
  evaluation_scheduled_at?: string;
  row_count?: number;
  evidence_truncated?: 0 | 1;
  evidence_json?: string;
  delivery_target_type?: "" | "email" | "telegram";
  delivery_outcome?: "" | "sent" | "failed" | "silenced";
  silence_id?: string;
}

export async function insertAlertEvents(rows: AlertEventRow[]): Promise<void> {
  if (rows.length === 0) return;

  await instrumentClickhouseOperation(
    { client: "admin", operation: "INSERT" },
    () =>
      clickhouseAdmin.insert({
        table: "app.alert_events",
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 1,
        },
      }),
  );
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

  await adminCommand(
    `CREATE USER IF NOT EXISTS \`${username}\` IDENTIFIED WITH sha256_password BY '${password}' SETTINGS PROFILE 'sql_api_profile'`,
  );
  // CH 26 requires sql_api_role to be active for WITH ADMIN OPTION to work,
  // but DEFAULT ROLE NONE keeps it off to avoid the readonly profile. Activate
  // it in an ephemeral session scoped to just these two statements.
  const sessionId = randomUUID();
  await adminCommand("SET ROLE sql_api_role", {
    clickhouse_settings: { session_id: sessionId },
  });
  await adminCommand(`GRANT sql_api_role TO \`${username}\``, {
    clickhouse_settings: { session_id: sessionId },
  });
  // DEFAULT ROLE has to come after the GRANT — CH validates the role is
  // already granted to the user before it can be the default.
  await adminCommand(`ALTER USER \`${username}\` DEFAULT ROLE sql_api_role`);

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await adminCommand(
      `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = ${tenantLiteral} TO \`${username}\``,
    );
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
    await adminCommand(
      `DROP ROW POLICY IF EXISTS \`${policy}\` ON app.\`${table}\``,
    );
  }

  await adminCommand(`DROP USER IF EXISTS \`${username}\``);
}

function adminCommand(query: string, options: AdminCommandOptions = {}) {
  return instrumentClickhouseOperation(
    { client: "admin", operation: "QUERY" },
    () =>
      clickhouseAdmin.command({
        query,
        ...options,
      }),
  );
}
