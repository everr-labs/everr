import { createHmac } from "node:crypto";
import { appEnv } from "@/cloud/app/env";

export function sqlApiOrgUserName(organizationId: string): string {
  return `sql_api_org_${organizationId}`;
}

export function sqlApiOrgPassword(organizationId: string): string {
  return `${createHmac("sha256", appEnv.CLICKHOUSE_SQL_API_MASTER_KEY)
    .update(organizationId, "utf8")
    .digest("hex")}A!`; // CH requires at least an uppercase and a special char
}
