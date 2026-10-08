import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { parseCronItems, type Task, type TaskList } from "graphile-worker";
import { z } from "zod";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import type { Database } from "@/db/client";
import { organization } from "@/db/schema";
import {
  deprovisionSqlApiOrgUser,
  provisionSqlApiOrgUser,
} from "@/lib/clickhouse";
import { deletePostgresOrganizationData } from "@/lib/organization-data-cleanup.server";
import {
  organizationProvisioningPending,
  provisionedOrganizationMetadata,
} from "@/lib/organization-provisioning-metadata.server";
import { withBoundaryErrorCapture } from "@/telemetry/error-boundary";
import {
  mergeTelemetryIdentity,
  withTelemetryIdentityScope,
} from "@/telemetry/identity";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import {
  DEPROVISION_ORGANIZATION_TASK,
  enqueueOrganizationProvisioning,
  ORGANIZATION_MAX_ATTEMPTS,
  PROVISION_ORGANIZATION_TASK,
} from "./jobs";

const payloadSchema = z.object({ organizationId: z.string().min(1) });
const SCAN_PENDING_TASK = "clickhouse/scan-pending-organizations";
const PROVISIONING_STALLED_SECONDS = 120;
const tracer = trace.getTracer("everr-app.organization-provisioning");

function organizationJob(name: string, run: Task): Task {
  return context.bind(ROOT_CONTEXT, async (payload, helpers) =>
    withTelemetryIdentityScope(() =>
      withBoundaryErrorCapture(() =>
        tracer.startActiveSpan(
          name,
          { kind: SpanKind.CONSUMER },
          async (span) => {
            const job = helpers.job;
            const attributes = {
              "everr.worker.task.name": name,
              ...(job
                ? {
                    "everr.worker.job.id": String(job.id),
                    "everr.worker.job.attempt": job.attempts,
                    "everr.worker.job.max_attempts": job.max_attempts,
                  }
                : {}),
            };
            span.setAttributes(attributes);
            try {
              await run(payload, helpers);
            } catch (error) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : String(error),
              });
              serverLogger.error(`${name}.failed`, {
                ...attributes,
                ...exceptionAttributes(error),
                "everr.worker.job.exhausted":
                  !!job && job.attempts >= job.max_attempts,
              });
              throw error;
            } finally {
              span.end();
            }
          },
        ),
      ),
    ),
  );
}

function organizationLifecycleJob(
  name: string,
  run: (organizationId: string, helpers: Parameters<Task>[1]) => Promise<void>,
): Task {
  return organizationJob(name, async (payload, helpers) => {
    const { organizationId } = payloadSchema.parse(payload);
    mergeTelemetryIdentity({ organizationId });
    await run(organizationId, helpers);
  });
}

export function createOrganizationTaskList(
  database: Database,
  recoverRetries: () => Promise<void>,
): TaskList {
  const cleanup = async (organizationId: string, abortSignal?: AbortSignal) => {
    await deletePostgresOrganizationData(organizationId, database);
    await deprovisionSqlApiOrgUser(organizationId, abortSignal);
  };
  return {
    [PROVISION_ORGANIZATION_TASK]: organizationLifecycleJob(
      "clickhouse.organization.provision",
      async (organizationId, helpers) => {
        const [org] = await database
          .select({ metadata: organization.metadata })
          .from(organization)
          .where(eq(organization.id, organizationId));
        if (!org) {
          await cleanup(organizationId, helpers.abortSignal);
          return;
        }
        if (isOrganizationProvisioned(org.metadata)) return;
        await provisionSqlApiOrgUser(organizationId, helpers.abortSignal);
        const updated = await database
          .update(organization)
          .set({ metadata: provisionedOrganizationMetadata })
          .where(
            and(
              eq(organization.id, organizationId),
              organizationProvisioningPending,
            ),
          )
          .returning({ id: organization.id });
        if (!updated.length) {
          const [remaining] = await database
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, organizationId));
          if (!remaining) await cleanup(organizationId, helpers.abortSignal);
        } else {
          serverLogger.info("clickhouse.organization.provision.completed", {
            "everr.organization.id": organizationId,
          });
        }
      },
    ),
    [DEPROVISION_ORGANIZATION_TASK]: organizationLifecycleJob(
      "clickhouse.organization.deprovision",
      async (organizationId, helpers) => {
        await cleanup(organizationId, helpers.abortSignal);
      },
    ),
    [SCAN_PENDING_TASK]: organizationJob(
      "clickhouse.organization.scan",
      async () => {
        // Recovery is useful but must never disable a healthy worker or scanner.
        try {
          await recoverRetries();
        } catch (error) {
          serverLogger.error(
            "clickhouse.organization.retry_recovery.failed",
            exceptionAttributes(error),
          );
        }
        const pending = await database
          .select({ id: organization.id, createdAt: organization.createdAt })
          .from(organization)
          .where(organizationProvisioningPending);
        const ages = pending.map((org) =>
          Math.max(0, (Date.now() - org.createdAt.getTime()) / 1000),
        );
        const stalled = ages.filter(
          (age) => age >= PROVISIONING_STALLED_SECONDS,
        ).length;
        serverLogger.info("clickhouse.organization.provision.health", {
          "everr.provisioning.pending_count": pending.length,
          "everr.provisioning.stalled_count": stalled,
          "everr.provisioning.oldest_pending_seconds": ages.reduce(
            (oldest, age) => Math.max(oldest, age),
            0,
          ),
        });
        for (const [index, org] of pending.entries()) {
          if (ages[index] >= PROVISIONING_STALLED_SECONDS) {
            serverLogger.error("clickhouse.organization.provision.stalled", {
              "everr.organization.id": org.id,
              "everr.provisioning.pending_seconds": ages[index],
            });
          }
          await enqueueOrganizationProvisioning(org.id, database);
        }
      },
    ),
  };
}

export const organizationProvisioningCronItems = parseCronItems([
  {
    task: SCAN_PENDING_TASK,
    match: "* * * * *",
    identifier: "clickhouse-pending-organizations",
    options: {
      backfillPeriod: 0,
      priority: -100,
      maxAttempts: ORGANIZATION_MAX_ATTEMPTS,
    },
  },
]);
