import { server } from "@composition/server";
import { previewSqlApi, querySqlApi, querySqlApiWithMeta } from "./clickhouse";

/** SQL API access for an organization whose storage is ready. */
export function createOrganizationSql(
  organizationId: string,
  metadata: unknown,
) {
  server.assertStorageReady(metadata);
  return {
    query: <T>(sql: string, params?: Record<string, unknown>) =>
      querySqlApi<T>(sql, organizationId, params),
    queryWithMeta: <T>(sql: string) =>
      querySqlApiWithMeta<T>(sql, organizationId),
    preview: (sql: string, maxRows: number) =>
      previewSqlApi(sql, organizationId, maxRows),
  };
}

/** Organization-bound SQL capabilities backed by ready storage. */
export type OrganizationSql = ReturnType<typeof createOrganizationSql>;
