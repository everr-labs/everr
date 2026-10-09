import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/env";
import { createClient } from "@/lib/clickhouse-client";
import { SQL_API_TENANT_TABLES } from "@/lib/sql-api-tables";
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

type AppQuerySettings = NonNullable<
  Parameters<typeof clickhouse.query>[0]["clickhouse_settings"]
>;

export async function query<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
  // Per-query, not a client default: this client is shared with dashboards,
  // where a global execution-time cap could cut off a legitimate long scan.
  clickhouse_settings?: AppQuerySettings,
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
          ...clickhouse_settings,
          // Last, so a caller-supplied setting can never override the tenant scope.
          SQL_everr_tenant_id: organizationId,
        },
      }),
  );

  return result.json<T>();
}

// Every provisioning statement interpolates the organization id into DDL: the
// username inside backticks, and the tenant id inside the row policy's string
// literal. better-auth generates the id today, so it is not caller-chosen,
// and this keeps it that way rather than trusting that it stays true.
function assertSqlApiOrgId(organizationId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(organizationId)) {
    throw new Error("organization id is not safe to interpolate into DDL");
  }
}

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
function runSqlApiQuery<
  Format extends "JSONEachRow" | "JSON" | "JSONCompactEachRowWithNamesAndTypes",
>(
  query: string,
  organizationId: string,
  query_params: Record<string, unknown> | undefined,
  format: Format,
  abort_signal?: AbortSignal,
) {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }

  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);

  return instrumentClickhouseOperation(
    { client: "sql_api", operation: "QUERY" },
    () =>
      clickhouse.query({
        query,
        query_params,
        format,
        ...(abort_signal ? { abort_signal } : {}),
        auth: { username, password },
        // Per-tenant quota bucket. sql_api_quota is KEYED BY client_key, so each
        // org gets its own counters. The header value is server-derived from
        // session.activeOrganizationId — never forwarded from CLI input.
        http_headers: { "X-ClickHouse-Quota": username },
      }),
  );
}

export async function querySqlApi<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (!organizationId) throw new Error("Missing ClickHouse tenant context");
  const result = await runSqlApiQuery(
    query,
    organizationId,
    query_params,
    "JSONEachRow",
  );
  return result.json<T>();
}

export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  /** ClickHouse type per column, parallel to `columns` ("" when absent). */
  columnTypes: string[];
}

export async function querySqlApiWithMeta<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<SqlApiResult<T>> {
  if (!organizationId) throw new Error("Missing ClickHouse tenant context");
  // JSON (not JSONEachRow) so column metadata is present even for empty results.
  const result = await runSqlApiQuery(
    query,
    organizationId,
    query_params,
    "JSON",
  );

  const body = (await result.json()) as {
    meta?: { name: string; type?: string }[];
    data?: T[];
  };
  return {
    rows: body.data ?? [],
    columns: (body.meta ?? []).map((m) => m.name),
    columnTypes: (body.meta ?? []).map((m) => m.type ?? ""),
  };
}

export interface SqlApiPreview {
  columns: string[];
  columnTypes: string[];
  /** One array per row, values in `columns` order. */
  rows: unknown[][];
  /** The query had more than `maxRows` rows; the rest were never read. */
  truncated: boolean;
}

/**
 * Read at most `maxRows` rows of a SQL API query, then cancel it. For callers
 * that show a preview (the MCP tool): ClickHouse stops producing rows when the
 * connection closes, instead of sending up to the profile's 25k rows / 4 MB to
 * be discarded here. Column names and types arrive even for an empty result.
 */
export async function previewSqlApi(
  query: string,
  organizationId: string,
  maxRows: number,
): Promise<SqlApiPreview> {
  if (!organizationId) throw new Error("Missing ClickHouse tenant context");
  const abort = new AbortController();
  const result = await runSqlApiQuery(
    query,
    organizationId,
    undefined,
    "JSONCompactEachRowWithNamesAndTypes",
    abort.signal,
  );

  // The first two lines are the column names and the column types.
  const lines: unknown[][] = [];
  let truncated = false;
  try {
    read: for await (const batch of result.stream()) {
      for (const row of batch) {
        if (lines.length === maxRows + 2) {
          truncated = true;
          break read;
        }
        lines.push(row.json<unknown[]>());
      }
    }
  } finally {
    abort.abort();
  }

  const [columns = [], columnTypes = [], ...rows] = lines;
  return {
    columns: columns as string[],
    columnTypes: columnTypes as string[],
    rows,
    truncated,
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

type AdminInsertSettings = Parameters<
  typeof clickhouseAdmin.insert
>[0]["clickhouse_settings"];

// Generic admin-client insert for app-owned tables; row typing lives with the
// feature that owns the table.
export async function insertAdminRows(
  table: string,
  rows: object[],
  clickhouse_settings?: AdminInsertSettings,
): Promise<void> {
  if (rows.length === 0) return;

  await instrumentClickhouseOperation(
    { client: "admin", operation: "INSERT" },
    () =>
      clickhouseAdmin.insert({
        table,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings,
      }),
  );
}

// Create the per-org ClickHouse user, set its profile + default role, grant
// sql_api_role, and create the per-table row policies that pin the tenant id
// in as a constant.
export async function provisionSqlApiOrgUser(
  organizationId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  assertSqlApiOrgId(organizationId);
  const username = sqlApiOrgUserName(organizationId);
  const password = sqlApiOrgPassword(organizationId);
  const tenantLiteral = `'${organizationId}'`;
  const command = (sql: string, options: AdminCommandOptions = {}) =>
    adminCommand(sql, {
      ...options,
      ...(abortSignal ? { abort_signal: abortSignal } : {}),
    });

  await command(
    `CREATE USER IF NOT EXISTS \`${username}\` IDENTIFIED WITH sha256_password BY '${password}' SETTINGS PROFILE 'sql_api_profile'`,
  );
  // CH 26 requires sql_api_role to be active for WITH ADMIN OPTION to work,
  // but DEFAULT ROLE NONE keeps it off to avoid the readonly profile. Activate
  // it in an ephemeral session scoped to just these two statements.
  const sessionId = randomUUID();
  await command("SET ROLE sql_api_role", {
    clickhouse_settings: { session_id: sessionId },
  });
  await command(`GRANT sql_api_role TO \`${username}\``, {
    clickhouse_settings: { session_id: sessionId },
  });
  // DEFAULT ROLE has to come after the GRANT — CH validates the role is
  // already granted to the user before it can be the default.
  await command(`ALTER USER \`${username}\` DEFAULT ROLE sql_api_role`);

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await command(
      `CREATE ROW POLICY IF NOT EXISTS \`${policy}\` ON app.\`${table}\` FOR SELECT USING tenant_id = ${tenantLiteral} TO \`${username}\``,
    );
  }

  // Authenticate through the same client as user queries before publishing
  // readiness. Request boundaries enforce readiness for user queries.
  const result = await runSqlApiQuery(
    "SELECT 1 FROM app.traces LIMIT 0",
    organizationId,
    undefined,
    "JSONEachRow",
    abortSignal,
  );
  await result.json();
}

// Reverse of provisionSqlApiOrgUser. Order is important: drop the policies
// before the user so DROP USER doesn't fail with "user is referenced".
export async function deprovisionSqlApiOrgUser(
  organizationId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  assertSqlApiOrgId(organizationId);
  const username = sqlApiOrgUserName(organizationId);

  for (const table of SQL_API_TENANT_TABLES) {
    const policy = sqlApiOrgPolicyName(organizationId, table);
    await adminCommand(
      `DROP ROW POLICY IF EXISTS \`${policy}\` ON app.\`${table}\``,
      abortSignal ? { abort_signal: abortSignal } : {},
    );
  }

  await adminCommand(
    `DROP USER IF EXISTS \`${username}\``,
    abortSignal ? { abort_signal: abortSignal } : {},
  );
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
