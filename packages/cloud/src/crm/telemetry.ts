import { metrics } from "@opentelemetry/api";
import { serverLogger } from "@everr/app/telemetry/logger";
import type { MembershipSyncPayload, OrganizationSyncPayload, UserSyncPayload } from "./jobs";

const meter = metrics.getMeter("everr-cloud.crm");
const outcomes = meter.createCounter("everr.crm.sync.outcomes", { unit: "1" });
const lag = meter.createHistogram("everr.crm.sync.lag", { unit: "s" });
export type SyncOutcome = "synced" | "deferred" | "retry" | "blocked" | "exhausted" | "invalid";
export type SyncDiagnostic = (
  outcome: SyncOutcome,
  payload?: UserSyncPayload | OrganizationSyncPayload | MembershipSyncPayload,
  jobId?: string,
) => void;

/** No provider bodies, exceptions, email or profile fields, and bounded metric dimensions. */
export const syncDiagnostic: SyncDiagnostic = (outcome, payload, jobId) => {
  try {
    const kind = payload && "kind" in payload ? payload.kind : "user";
    const dimensions = { "everr.crm.outcome": outcome, "everr.crm.entity_kind": kind };
    outcomes.add(1, dimensions);
    if (payload)
      lag.record(Math.max(0, (Date.now() - Date.parse(payload.occurredAt)) / 1000), dimensions);
    serverLogger[
      outcome === "blocked" || outcome === "exhausted" || outcome === "invalid" ? "error" : "info"
    ](`crm.${kind}.sync`, {
      ...dimensions,
      ...(jobId ? { "everr.worker.job.id": jobId } : {}),
      ...(payload
        ? {
            "everr.business_event.id": payload.eventId,
            "everr.business_event.type": payload.eventType,
            ...("userId" in payload ? { "everr.crm.user.id": payload.userId } : {}),
            ...("organizationId" in payload
              ? { "everr.crm.organization.id": payload.organizationId }
              : {}),
            "everr.crm.failures": payload.failures,
          }
        : {}),
    });
  } catch {
    /* Diagnostics cannot alter persisted work. */
  }
};
