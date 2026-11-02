import type { Database } from "@everr/app/db/database";
import type { JobHelpers, Task, TaskList } from "graphile-worker";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { z } from "zod";
import { BrevoFailure, type createBrevoAdapter } from "./brevo/adapter";
import {
  FULL_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  fullSyncPayload,
  membershipSyncPayload,
  organizationSyncPayload,
  userSyncPayload,
  relatedSyncSpec,
  userSyncSpec,
} from "./commands";
import { createFullSync } from "./full-sync";
import { createCrmSync } from "./sync";
import type { createCrmSnapshotReader, SourceSnapshot } from "./snapshots";
import { syncDiagnostic, type CrmPayload, type SyncDiagnostic } from "./telemetry";

/** All entry points run in CRM_QUEUE; queue ownership replaces endpoint locks. */
export function createCrmTaskList(options: {
  database: Database;
  reader: ReturnType<typeof createCrmSnapshotReader>;
  adapter: ReturnType<typeof createBrevoAdapter>;
  diagnostic?: SyncDiagnostic;
}): TaskList {
  const { reader, diagnostic = syncDiagnostic } = options;
  const sync = createCrmSync(options);
  const fanout = async (source: SourceSnapshot, origin: CrmPayload, helpers: JobHelpers) => {
    if (source.deleted) return;
    for (const pair of source.memberships) {
      await helpers.addJob(
        MEMBERSHIP_SYNC_TASK,
        {
          version: 1,
          kind: "membership",
          userId: pair.userId,
          organizationId: pair.organizationId,
          eventId: origin.eventId,
          eventType: origin.eventType,
          occurredAt: origin.occurredAt,
          ...(origin.prune ? { prune: true } : {}),
        },
        relatedSyncSpec(pair.organizationId, pair.userId),
      );
    }
  };
  const differs = (before: SourceSnapshot, after: SourceSnapshot) =>
    before.deleted !== after.deleted ||
    JSON.stringify("fields" in before ? before.fields : null) !==
      JSON.stringify("fields" in after ? after.fields : null);
  function task<P extends CrmPayload>(
    schema: z.ZodType<P>,
    run: (payload: P, helpers: JobHelpers) => Promise<void>,
    completed = true,
  ): Task {
    return async (raw, helpers) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        diagnostic("invalid", undefined, String(helpers.job.id), { code: "invalid_command" });
        return;
      }
      const payload = parsed.data;
      await trace
        .getTracer("everr-cloud.crm")
        .startActiveSpan(helpers.job.task_identifier, async (span) => {
          const attempt = helpers.job.attempts;
          span.setAttribute("everr.worker.job.id", String(helpers.job.id));
          span.setAttribute("everr.business_event.id", payload.eventId);
          try {
            await run(payload, helpers);
            if (completed)
              diagnostic("synced", payload, String(helpers.job.id), {
                attempt,
                operation: helpers.job.task_identifier,
              });
          } catch (error) {
            const failure = error instanceof BrevoFailure ? error.failure : undefined;
            const retryable =
              !failure || failure.kind === "transient" || failure.kind === "cancelled";
            const outcome = retryable
              ? attempt >= helpers.job.max_attempts
                ? "exhausted"
                : "retry"
              : "failed";
            const code = failure?.code ?? "infrastructure_failure";
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttribute("error.type", code);
            diagnostic(outcome, payload, String(helpers.job.id), {
              attempt,
              code,
              operation: helpers.job.task_identifier,
              ...(outcome === "retry"
                ? {
                    nextAttemptAt: new Date(
                      Date.now() + Math.exp(Math.min(attempt, 10)) * 1000,
                    ).toISOString(),
                  }
                : {}),
            });
            if (retryable) {
              // eslint-disable-next-line preserve-caught-error -- Raw infrastructure causes can contain profile data.
              throw new Error(`CRM synchronization failed: ${code}`);
            }
          } finally {
            span.end();
          }
        });
    };
  }
  return {
    [USER_SYNC_TASK]: task(userSyncPayload, async (payload, helpers) => {
      const result = await sync.user(payload.userId, helpers.abortSignal, payload.prune);
      const current = await reader.user(payload.userId);
      if (differs(result.source, current))
        await helpers.addJob(USER_SYNC_TASK, payload, userSyncSpec(payload.userId));
      await fanout(current, payload, helpers);
    }),
    [ORGANIZATION_SYNC_TASK]: task(organizationSyncPayload, async (payload, helpers) => {
      const result = await sync.organization(
        payload.organizationId,
        helpers.abortSignal,
        payload.prune,
      );
      const current = await reader.organization(payload.organizationId);
      if (differs(result.source, current))
        await helpers.addJob(
          ORGANIZATION_SYNC_TASK,
          payload,
          relatedSyncSpec(payload.organizationId),
        );
      await fanout(current, payload, helpers);
    }),
    [MEMBERSHIP_SYNC_TASK]: task(membershipSyncPayload, async (payload, helpers) => {
      const { previous, ...current } = payload;
      for (const pair of previous ? [previous, current] : [current]) {
        const linked = await sync.membership(
          pair.userId,
          pair.organizationId,
          helpers.abortSignal,
          payload.prune,
        );
        if (linked !== (await reader.membership(pair.userId, pair.organizationId)))
          await helpers.addJob(
            MEMBERSHIP_SYNC_TASK,
            { ...current, userId: pair.userId, organizationId: pair.organizationId },
            relatedSyncSpec(pair.organizationId, pair.userId),
          );
      }
    }),
    [FULL_SYNC_TASK]: task(fullSyncPayload, createFullSync(options), false),
  };
}
