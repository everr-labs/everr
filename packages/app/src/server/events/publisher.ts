import { randomUUID } from "node:crypto";
import type { ApplicationEvents, EventPublisher } from "#app/composition/events.ts";
import { addWorkerJob } from "#app/server/worker/jobs.ts";
import { exceptionAttributes, serverLogger } from "#app/telemetry/logger.ts";

type FailureStage = "validation" | "job" | "enqueue";

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
        let stage: FailureStage = "validation";
        let task: string | undefined;
        try {
          // Parse errors may contain raw payloads. Keep them out of diagnostics.
          let parsed;
          try {
            parsed = route.definition.parse(fact);
          } catch {
            throw new Error("Business event validation failed");
          }
          stage = "job";
          const job = route.job({ ...parsed, id, occurredAt });
          task = job.task;
          stage = "enqueue";
          await enqueue(job.task, job.payload, job.spec);
        } catch (error) {
          logPublicationFailure({
            eventType: route.definition.type,
            eventVersion: route.definition.version,
            eventId: id,
            subjectId: fact.subjectId,
            stage,
            task,
            error,
          });
        }
      }
    },
  };
}

/** No fact payloads enter diagnostics. */
function logPublicationFailure(failure: {
  eventType: string;
  eventVersion: number;
  eventId: string;
  subjectId: string;
  stage: FailureStage;
  task?: string;
  error: unknown;
}): void {
  try {
    serverLogger.error("business_events.publication.failed", {
      ...exceptionAttributes(failure.error),
      "everr.business_event.type": failure.eventType,
      "everr.business_event.version": failure.eventVersion,
      "everr.business_event.failure_stage": failure.stage,
      ...(failure.eventId ? { "everr.business_event.id": failure.eventId } : {}),
      ...(failure.subjectId ? { "everr.business_event.subject_id": failure.subjectId } : {}),
      ...(failure.task ? { "everr.business_event.task": failure.task } : {}),
    });
  } catch {
    // Diagnostics cannot affect publication.
  }
}
