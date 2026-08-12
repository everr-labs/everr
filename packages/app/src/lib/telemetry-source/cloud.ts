import { executePanelSql } from "@/data/dashboards/server";
import type { SqlClient } from "./types";

/**
 * Reads through the app server, which runs the SQL as the per-org ClickHouse
 * user. This is the path the app has always used; the only change is that the
 * SQL now arrives already interpolated from PanelRepository instead of being
 * interpolated inside the server function.
 */
export function createCloudSqlClient(): SqlClient {
  return {
    async execute<Row>(sql: string, params: Record<string, unknown>) {
      const { rows } = await executePanelSql({
        data: { sql, params: params as Record<string, string | number> },
      });
      return rows as Row[];
    },
  };
}
