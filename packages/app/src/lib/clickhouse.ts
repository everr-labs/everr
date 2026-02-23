import { createClient } from "@clickhouse/client";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getTenantForOrganizationId } from "@/data/tenants";
import { env } from "@/env";
import { getRequestContextFromStartContext } from "@/lib/start-context";

export const clickhouse = createClient({
  url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
});

async function resolveOrganizationIdForQuery() {
  const organizationIdFromContext =
    getRequestContextFromStartContext()?.organizationId;
  if (organizationIdFromContext) {
    return organizationIdFromContext;
  }

  const auth = await getAuth();
  if (!auth.user || !auth.organizationId) {
    throw new Error(
      "Authenticated organization is required for ClickHouse queries.",
    );
  }

  return auth.organizationId;
}

export async function query<T>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const organizationId = await resolveOrganizationIdForQuery();

  const tenantId = await getTenantForOrganizationId(organizationId);
  if (tenantId === null) {
    throw new Error("No tenant mapping found for authenticated organization.");
  }

  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_citric_tenant_id: tenantId,
    },
  });

  return result.json<T>();
}
