import { storage } from "@composition/storage";
import { previewSqlApi, querySqlApi, querySqlApiWithMeta, runSqlApiQuery } from "./clickhouse";

/** SQL API access for an organization whose storage is ready. */
export function createOrganizationSql(organizationId: string, metadata: unknown) {
  storage.assertStorageReady(metadata);
  return {
    query: <T>(sql: string, params?: Record<string, unknown>) =>
      querySqlApi<T>(sql, organizationId, params),
    queryColumns: async (sql: string, params?: Record<string, unknown>) =>
      (await runSqlApiQuery(sql, organizationId, params, "JSONColumnsWithMetadata")).text(),
    queryWithMeta: <T>(sql: string) => querySqlApiWithMeta<T>(sql, organizationId),
    preview: (sql: string, maxRows: number) => previewSqlApi(sql, organizationId, maxRows),
  };
}

/** Organization-bound SQL capabilities backed by ready storage. */
export type OrganizationSql = ReturnType<typeof createOrganizationSql>;
