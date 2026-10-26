import { randomUUID } from "node:crypto";
import type { ApplicationEvents, EventPublisher } from "#app/composition/events.ts";
import { addWorkerJob } from "#app/server/worker/jobs.ts";
import { metrics } from "@opentelemetry/api";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";

/** The only dispatch mechanism is Graphile. Routes build jobs, never run handlers. */
export function createEventPublisher(options: {
  routes: ApplicationEvents;
  enqueue?: typeof addWorkerJob;
}): EventPublisher {
  const { routes, enqueue = addWorkerJob } = options;
  return {
    async publish(fact) {
      const id = randomUUID();
      const occurredAt = new Date().toISOString();
      for (const route of routes) {
        if (route.definition.type !== fact.type || route.definition.version !== fact.version)
          continue;
        let stage: "validation" | "subscriber" = "validation";
        try {
          // Parse errors may contain raw payloads. Keep them out of diagnostics.
          let parsed;
          try {
            parsed = route.definition.parse(fact);
          } catch {
            throw new Error("Business event validation failed");
          }
          const job = route.job({ ...parsed, id, occurredAt });
          stage = "subscriber";
          await enqueue(job.task, job.payload, job.spec);
        } catch (error) {
          logPublicationFailure({
            eventType: route.definition.type,
            eventId: id,
            subjectId: fact.subjectId,
            stage,
            error,
          });
        }
      }
    },
  };
}

// Keep these diagnostic identities stable across implementation renames.
const failures = metrics
  .getMeter("everr-app.business-events")
  .createCounter("everr.business_events.publication.failures", {
    description: "Best-effort business event publication failures and drops",
    unit: "1",
  });

/** Emit both signals independently. No fact payloads enter diagnostics. */
function logPublicationFailure(failure: {
  eventType: string;
  eventId: string;
  subjectId: string;
  stage: "validation" | "subscriber";
  error: unknown;
}): void {
  try {
    serverLogger.error("business_events.publication.failed", {
      ...exceptionAttributes(failure.error),
      "everr.business_event.type": failure.eventType,
      "everr.business_event.subscriber": failure.eventType,
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
      "everr.business_event.subscriber": failure.eventType,
      "everr.business_event.failure_stage": failure.stage,
    });
  } catch {
    // Metric failures cannot affect publication.
  }
}
