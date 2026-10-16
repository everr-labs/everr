import { sql } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import { addWorkerJobUsing } from "@/server/worker/jobs";

export const ORGANIZATION_MAX_ATTEMPTS = 1_000;

export const PROVISION_ORGANIZATION_TASK = "clickhouse/provision-organization";
export const DEPROVISION_ORGANIZATION_TASK =
  "clickhouse/deprovision-organization";

export function organizationLifecycleJobKey(
  organizationId: string,
  action: "provision" | "deprovision",
) {
  return `clickhouse-organization:${organizationId}:${action}`;
}

function lifecycleSpec(
  organizationId: string,
  action: "provision" | "deprovision",
) {
  return {
    queueName: `clickhouse-organization:${organizationId}`,
    jobKey: organizationLifecycleJobKey(organizationId, action),
    maxAttempts: ORGANIZATION_MAX_ATTEMPTS,
    // Scans must not reset attempts, bring retries forward, or duplicate a
    // running job. Payloads are immutable and the handlers are idempotent.
    jobKeyMode: "unsafe_dedupe" as const,
  };
}

export async function restartOrganizationProvisioningJob(
  organizationId: string,
  executor: DbExecutor = db,
) {
  await executor.execute(sql`
    SELECT graphile_worker.reschedule_jobs(
      ARRAY[j.id], attempts := 0, run_at := now(),
      max_attempts := ${ORGANIZATION_MAX_ATTEMPTS}
    ) FROM graphile_worker.jobs j
    WHERE j.task_identifier = ${PROVISION_ORGANIZATION_TASK}
      AND j.key = ${organizationLifecycleJobKey(organizationId, "provision")}
      AND j.attempts >= j.max_attempts AND j.locked_at IS NULL
  `);
}

export async function enqueueOrganizationProvisioning(
  organizationId: string,
  executor: DbExecutor = db,
) {
  await addWorkerJobUsing(
    executor,
    PROVISION_ORGANIZATION_TASK,
    { organizationId },
    lifecycleSpec(organizationId, "provision"),
  );
}

export async function enqueueOrganizationDeprovisioning(
  organizationId: string,
  executor: DbExecutor = db,
) {
  await addWorkerJobUsing(
    executor,
    DEPROVISION_ORGANIZATION_TASK,
    { organizationId },
    lifecycleSpec(organizationId, "deprovision"),
  );
}
