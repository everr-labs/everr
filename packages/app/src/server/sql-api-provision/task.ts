import { eq } from "drizzle-orm";
import type { TaskList } from "graphile-worker";
import { z } from "zod";
import { db } from "@/db/client";
import { organization } from "@/db/schema";
import {
  deprovisionSqlApiOrgUser,
  provisionSqlApiOrgUser,
} from "@/lib/clickhouse";
import { serverLogger } from "@/telemetry/logger";
import { markSqlApiOrgUserReady, SQL_API_PROVISION_TASK } from "./status";

const payloadSchema = z.object({
  organizationId: z.string().min(1),
});

async function organizationExists(organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return rows.length > 0;
}

// Throws on a real provision failure so Graphile retries. A deleted
// organization is terminal: recreating its ClickHouse user would leak it.
export async function runSqlApiOrgUserProvision(
  payload: unknown,
): Promise<void> {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    serverLogger.error("sql_api.org_user.provision.invalid_payload", {
      "exception.message": parsed.error.message,
    });
    return;
  }

  const { organizationId } = parsed.data;
  if (!(await organizationExists(organizationId))) return;

  await provisionSqlApiOrgUser(organizationId);

  if (!(await organizationExists(organizationId))) {
    await deprovisionSqlApiOrgUser(organizationId);
    return;
  }

  markSqlApiOrgUserReady(organizationId);
}

export const sqlApiProvisionTaskList: TaskList = {
  [SQL_API_PROVISION_TASK]: (payload) => runSqlApiOrgUserProvision(payload),
};
