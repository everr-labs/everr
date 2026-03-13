import { createServerOnlyFn } from "@tanstack/react-start";
import { getRequestContextFromStartContext } from "@/lib/start-context";

type ClickHouseClient = ReturnType<
  typeof import("@clickhouse/client")["createClient"]
>;

let clickhouseClientPromise: Promise<ClickHouseClient> | undefined;
const clickhouseModuleId = "@clickhouse/client";

const getClickHouseClient = createServerOnlyFn(
  async function getClickHouseClient() {
    if (!clickhouseClientPromise) {
      clickhouseClientPromise = Promise.all([
        import(/* @vite-ignore */ clickhouseModuleId),
        import("@/env"),
      ]).then(([{ createClient }, { env }]) =>
        createClient({
          url: env.CLICKHOUSE_URL,
          username: env.CLICKHOUSE_USERNAME,
          password: env.CLICKHOUSE_PASSWORD,
          database: env.CLICKHOUSE_DATABASE,
        }),
      );
    }

    return clickhouseClientPromise;
  },
);

const resolveTenantIdForQuery = createServerOnlyFn(
  async function resolveTenantIdForQuery() {
    const tenantIdFromContext = getRequestContextFromStartContext()?.tenantId;
    if (tenantIdFromContext) {
      return tenantIdFromContext;
    }

    const [{ getAuth }, { getTenantForOrganizationId }] = await Promise.all([
      import("@workos/authkit-tanstack-react-start"),
      import("@/data/tenants"),
    ]);

    const auth = await getAuth();
    if (!auth.user || !auth.organizationId) {
      throw new Error(
        "Authenticated organization is required for ClickHouse queries.",
      );
    }

    const tenantId = await getTenantForOrganizationId(auth.organizationId);
    if (tenantId === null) {
      throw new Error(
        "No tenant mapping found for authenticated organization.",
      );
    }

    return tenantId;
  },
);

export const query = createServerOnlyFn(async function query<T>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const [clickhouse, tenantId] = await Promise.all([
    getClickHouseClient(),
    resolveTenantIdForQuery(),
  ]);

  const result = await clickhouse.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: {
      SQL_everr_tenant_id: tenantId,
    },
  });

  return result.json<T>();
});
