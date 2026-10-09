import { sql } from "drizzle-orm";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import { type DbExecutor, db } from "@/db/client";
import {
  organizationLifecycleJobKey,
  PROVISION_ORGANIZATION_TASK,
} from "./jobs";

export async function readOrganizationProvisioningStatus(
  organization: { id: string; metadata?: unknown },
  executor: DbExecutor = db,
): Promise<"ready" | "pending" | "failed"> {
  if (isOrganizationProvisioned(organization.metadata)) return "ready";
  const result = await executor.execute<{
    attempts: number;
    max_attempts: number;
    locked_at: Date | null;
  }>(sql`
    SELECT attempts, max_attempts, locked_at
    FROM graphile_worker.jobs
    WHERE task_identifier = ${PROVISION_ORGANIZATION_TASK}
      AND key = ${organizationLifecycleJobKey(organization.id, "provision")}
    LIMIT 1
  `);
  const job = result.rows[0];
  // The last attempt is still pending while it runs. A missed job remains
  // pending until the scanner recovers it, rather than implying readiness.
  return job && job.locked_at === null && job.attempts >= job.max_attempts
    ? "failed"
    : "pending";
}
