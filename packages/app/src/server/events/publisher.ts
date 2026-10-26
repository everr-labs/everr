import { randomUUID } from "node:crypto";
import type { ApplicationEvents, EventPublisher } from "#app/composition/events.ts";
import { addWorkerJob } from "#app/server/worker/jobs.ts";
import {
  publicationDiagnostics,
  reportPublicationFailure,
  type PublicationDiagnostics,
} from "./telemetry";

/** The only dispatch mechanism is Graphile. Routes build jobs, never run handlers. */
export function createEventPublisher(options: {
  routes: ApplicationEvents;
  enqueue?: typeof addWorkerJob;
  diagnostics?: PublicationDiagnostics;
}): EventPublisher {
  const { routes, enqueue = addWorkerJob, diagnostics = publicationDiagnostics } = options;
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
          reportPublicationFailure(diagnostics, {
            eventType: route.definition.type,
            eventId: id,
            subjectId: fact.subjectId,
            subscriberId: route.definition.type,
            stage,
            error,
          });
        }
      }
    },
  };
}
