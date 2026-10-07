import { type DbExecutor, db } from "@/db/client";
import { addWorkerJobUsing } from "@/server/worker/jobs";

// Keep several days of retries even with the short signup retry delay.
export const ORGANIZATION_MAX_ATTEMPTS = 10_000;

export const PROVISION_ORGANIZATION_TASK = "clickhouse/provision-organization";
export const DEPROVISION_ORGANIZATION_TASK =
  "clickhouse/deprovision-organization";

function lifecycleSpec(organizationId: string, action: string) {
  return {
    queueName: `clickhouse-organization:${organizationId}`,
    jobKey: `clickhouse-organization:${organizationId}:${action}`,
    maxAttempts: ORGANIZATION_MAX_ATTEMPTS,
    // Scans must not reset attempts, bring retries forward, or duplicate a
    // running job. Payloads are immutable and the handlers are idempotent.
    jobKeyMode: "unsafe_dedupe" as const,
  };
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
