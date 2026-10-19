import { server } from "@composition/server";
import { previewSqlApi, querySqlApi } from "./clickhouse";

/** SQL API access for an organization whose storage is ready. */
export function createOrganizationSql(
  organizationId: string,
  metadata: unknown,
) {
  server.assertStorageReady(metadata);
  return {
    query: <T>(sql: string) => querySqlApi<T>(sql, organizationId),
    preview: (sql: string, maxRows: number) =>
      previewSqlApi(sql, organizationId, maxRows),
  };
}
