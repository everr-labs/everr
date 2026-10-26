import { metrics } from "@opentelemetry/api";
import { serverLogger } from "@everr/app/telemetry/logger";
import type {
  MembershipSyncPayload,
  OrganizationSyncPayload,
  UserSyncPayload,
  FullSyncPayload,
} from "./commands";

export type CrmPayload =
  | MembershipSyncPayload
  | OrganizationSyncPayload
  | UserSyncPayload
  | FullSyncPayload;
export type SyncOutcome =
  | "synced"
  | "retry"
  | "failed"
  | "exhausted"
  | "invalid"
  | "preview"
  | "admitted";
export type SyncDiagnostic = (
  outcome: SyncOutcome,
  payload: CrmPayload | undefined,
  jobId: string,
  details?: {
    attempt?: number;
    code?: string;
    operation?: string;
    nextAttemptAt?: string;
    admitted?: number;
    candidates?: number;
  },
) => void;

// Resolve instruments at emission time, including callers loaded before SDK startup.
export const syncDiagnostic: SyncDiagnostic = (outcome, payload, jobId, details = {}) => {
  try {
    const kind =
      payload && "kind" in payload
        ? payload.kind
        : payload && "userId" in payload
          ? "user"
          : "full-sync";
    const dimensions = { "everr.crm.outcome": outcome, "everr.crm.entity_kind": kind };
    const meter = metrics.getMeter("everr-cloud.crm");
    meter.createCounter("everr.crm.sync.outcomes", { unit: "1" }).add(1, dimensions);
    if (payload)
      meter
        .createHistogram("everr.crm.sync.lag", { unit: "s" })
        .record(Math.max(0, (Date.now() - Date.parse(payload.occurredAt)) / 1000), dimensions);
    const attributes = {
      ...dimensions,
      "everr.worker.job.id": jobId,
      ...(payload
        ? {
            "everr.business_event.id": payload.eventId,
            "everr.business_event.type": payload.eventType,
          }
        : {}),
      ...(payload && "userId" in payload ? { "everr.crm.user.id": payload.userId } : {}),
      ...(payload && "organizationId" in payload
        ? { "everr.crm.organization.id": payload.organizationId }
        : {}),
      ...(details.code ? { "everr.crm.error_code": details.code } : {}),
      ...(details.operation ? { "everr.crm.operation": details.operation } : {}),
      ...(details.attempt === undefined ? {} : { "everr.worker.job.attempt": details.attempt }),
      ...(details.nextAttemptAt ? { "everr.crm.next_attempt_at": details.nextAttemptAt } : {}),
      ...(details.admitted === undefined ? {} : { "everr.crm.scan.admitted": details.admitted }),
      ...(details.candidates === undefined
        ? {}
        : { "everr.crm.scan.candidates": details.candidates }),
    };
    serverLogger[["failed", "exhausted", "invalid"].includes(outcome) ? "error" : "info"](
      "crm.sync",
      attributes,
    );
  } catch {
    /* Diagnostics cannot alter queue execution. */
  }
};

export function rateLimitDiagnostic(operation: string, waitMs: number) {
  try {
    const attributes = { "everr.crm.operation": operation, "http.response.status_code": 429 };
    const meter = metrics.getMeter("everr-cloud.crm");
    meter.createCounter("everr.crm.provider.rate_limits", { unit: "1" }).add(1, attributes);
    meter
      .createHistogram("everr.crm.provider.wait", { unit: "s" })
      .record(waitMs / 1000, attributes);
    serverLogger.info("crm.provider.backpressure", {
      ...attributes,
      "everr.crm.wait_ms": waitMs,
      "everr.crm.next_attempt_at": new Date(Date.now() + waitMs).toISOString(),
    });
  } catch {
    /* Diagnostics cannot alter provider backpressure. */
  }
}
