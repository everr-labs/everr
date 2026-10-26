import { metrics } from "@opentelemetry/api";
import { serverLogger } from "@everr/app/telemetry/logger";
import type { MembershipSyncPayload, OrganizationSyncPayload, UserSyncPayload } from "./commands";

const meter = metrics.getMeter("everr-cloud.crm");
const outcomes = meter.createCounter("everr.crm.sync.outcomes", { unit: "1" });
const lag = meter.createHistogram("everr.crm.sync.lag", { unit: "s" });
export type SyncOutcome = "synced" | "deferred" | "retry" | "blocked" | "exhausted" | "invalid";
export type SyncDiagnostic = (
  outcome: SyncOutcome,
  payload?: UserSyncPayload | OrganizationSyncPayload | MembershipSyncPayload,
  jobId?: string,
  retryFailures?: number,
) => void;

/** The optional count is observed durable state, never the legacy command mirror.
 * Unknown budgets (for example invalid commands) omit the attribute.
 * No provider bodies, exceptions, email or profile fields, and bounded metric dimensions.
 */
export const syncDiagnostic: SyncDiagnostic = (outcome, payload, jobId, retryFailures) => {
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
      ...(retryFailures === undefined ? {} : { "everr.crm.failures": retryFailures }),
      ...(jobId ? { "everr.worker.job.id": jobId } : {}),
      ...(payload
        ? {
            "everr.business_event.id": payload.eventId,
            "everr.business_event.type": payload.eventType,
            ...("userId" in payload ? { "everr.crm.user.id": payload.userId } : {}),
            ...("organizationId" in payload
              ? { "everr.crm.organization.id": payload.organizationId }
              : {}),
          }
        : {}),
    });
  } catch {
    /* Diagnostics cannot alter persisted work. */
  }
};

const reconciliation = meter.createCounter("everr.crm.reconciliation.outcomes", { unit: "1" });
const pendingAge = meter.createGauge("everr.crm.sync.oldest_known_pending", { unit: "s" });
/** Bounded operational metadata. Unknown pre-existing pending start times stay unknown. */
export function reconciliationDiagnostic(
  outcome: "progress" | "deferred" | "failure" | "drift" | "missing",
  metadata: {
    kind?: "user" | "organization" | "membership";
    pages?: number;
    admitted?: number;
    oldestKnownPendingSeconds?: number;
  } = {},
) {
  try {
    const dimensions = {
      "everr.crm.reconciliation.outcome": outcome,
      ...(metadata.kind ? { "everr.crm.entity_kind": metadata.kind } : {}),
    };
    reconciliation.add(1, dimensions);
    if (metadata.oldestKnownPendingSeconds !== undefined)
      pendingAge.record(metadata.oldestKnownPendingSeconds);
    serverLogger[outcome === "failure" || outcome === "missing" ? "error" : "info"](
      "crm.reconciliation",
      {
        ...dimensions,
        ...(metadata.pages === undefined
          ? {}
          : { "everr.crm.reconciliation.pages": metadata.pages }),
        ...(metadata.admitted === undefined
          ? {}
          : { "everr.crm.reconciliation.admitted": metadata.admitted }),
        ...(metadata.oldestKnownPendingSeconds === undefined
          ? {}
          : { "everr.crm.oldest_known_pending_seconds": metadata.oldestKnownPendingSeconds }),
      },
    );
  } catch {
    /* Diagnostics cannot alter persisted work. */
  }
}
