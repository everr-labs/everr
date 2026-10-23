import { metrics } from "@opentelemetry/api";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";
import type { PublicationDiagnostics } from "./publisher";

const failures = metrics
  .getMeter("everr-app.business-events")
  .createCounter("everr.business_events.publication.failures", {
    description: "Best-effort business event publication failures and drops",
    unit: "1",
  });

/** Called behind the publisher's nonthrowing diagnostic guard. No fact payloads. */
export const publicationDiagnostics: PublicationDiagnostics = {
  log(failure) {
    serverLogger.error("business_events.publication.failed", {
      ...exceptionAttributes(failure.error),
      "everr.business_event.type": failure.eventType,
      "everr.business_event.subscriber": failure.subscriberId,
      "everr.business_event.failure_stage": failure.stage,
      ...(failure.eventId ? { "everr.business_event.id": failure.eventId } : {}),
      ...(failure.subjectId ? { "everr.business_event.subject_id": failure.subjectId } : {}),
    });
  },
  count(failure) {
    failures.add(1, {
      "everr.business_event.type": failure.eventType,
      "everr.business_event.subscriber": failure.subscriberId,
      "everr.business_event.failure_stage": failure.stage,
    });
  },
};
