import { provisionSqlApiOrgUser } from "@/lib/clickhouse";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  enqueueSqlApiOrgUserProvision,
  SQL_API_SIGNUP_PROVISION_TIMEOUT_MS,
} from "./status";

// The organization row is already committed by the time this runs. A failed
// provision must not fail signup: the person gets a session, and a Graphile
// job keeps trying until the ClickHouse user exists.
export async function provisionSqlApiOrgUserOrEnqueue(
  organizationId: string,
): Promise<void> {
  try {
    await provisionSqlApiOrgUser(organizationId, {
      requestTimeoutMs: SQL_API_SIGNUP_PROVISION_TIMEOUT_MS,
    });
  } catch (error) {
    serverLogger.error("sql_api.org_user.provision.failed", {
      ...exceptionAttributes(error),
      "everr.organization.id": organizationId,
    });
    try {
      await enqueueSqlApiOrgUserProvision(organizationId);
    } catch (enqueueError) {
      serverLogger.error("sql_api.org_user.provision.enqueue_failed", {
        ...exceptionAttributes(enqueueError),
        "everr.organization.id": organizationId,
      });
    }
  }
}
