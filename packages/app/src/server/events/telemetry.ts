import { metrics } from "@opentelemetry/api";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";

// Keep these diagnostic identities stable across implementation renames.
const failures = metrics
  .getMeter("everr-app.business-events")
  .createCounter("everr.business_events.publication.failures", {
    description: "Best-effort business event publication failures and drops",
    unit: "1",
  });

/** Emit both signals independently. No fact payloads enter diagnostics. */
export const publicationDiagnostics: PublicationDiagnostics = (failure) => {
  try {
    serverLogger.error("business_events.publication.failed", {
      ...exceptionAttributes(failure.error),
      "everr.business_event.type": failure.eventType,
      "everr.business_event.subscriber": failure.subscriberId,
      "everr.business_event.failure_stage": failure.stage,
      ...(failure.eventId ? { "everr.business_event.id": failure.eventId } : {}),
      ...(failure.subjectId ? { "everr.business_event.subject_id": failure.subjectId } : {}),
    });
  } catch {
    // A broken logger cannot suppress the counter.
  }
  try {
    failures.add(1, {
      "everr.business_event.type": failure.eventType,
      "everr.business_event.subscriber": failure.subscriberId,
      "everr.business_event.failure_stage": failure.stage,
    });
  } catch {
    // Metric failures cannot affect publication.
  }
};
export type PublicationFailureStage = "validation" | "subscriber";
export interface PublicationFailure {
  /** Always a registered type, or the bounded sentinel "unknown". */
  eventType: string;
  eventId?: string;
  subjectId?: string;
  subscriberId: string;
  stage: PublicationFailureStage;
  error: unknown;
}
export type PublicationDiagnostics = (failure: PublicationFailure) => void | Promise<void>;

/** An injected reporter cannot change the source result or create an unhandled rejection. */
export function reportPublicationFailure(
  diagnostics: PublicationDiagnostics,
  failure: PublicationFailure,
): void {
  try {
    void Promise.resolve(diagnostics(failure)).catch(() => {});
  } catch {
    // Diagnostics are best effort too.
  }
}
