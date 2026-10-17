import type { ClickHouseSettings } from "@clickhouse/client";
import {
  sqlApiOrgPassword,
  sqlApiOrgUserName,
} from "../clickhouse/credentials";

export function appQuerySettings(
  organizationId: string,
  settings?: ClickHouseSettings,
) {
  return { ...settings, SQL_everr_tenant_id: organizationId };
}

export function sqlApiAccess(organizationId: string) {
  const username = sqlApiOrgUserName(organizationId);
  return {
    auth: { username, password: sqlApiOrgPassword(organizationId) },
    http_headers: { "X-ClickHouse-Quota": username },
  };
}
