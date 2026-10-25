import { randomUUID } from "node:crypto";
import type {
  ApplicationEvents,
  PublishedEvent,
  EventInput,
  EventPublisher,
} from "#app/composition/events.ts";

import {
  reportPublicationFailure,
  type PublicationDiagnostics,
  type PublicationFailure,
  type PublicationFailureStage,
} from "./diagnostics";
/** No queue or persistence of its own. Accepted work is bounded, excess facts are lost. */
export function createEventPublisher(options: {
  registrations: ApplicationEvents;
  diagnostics: PublicationDiagnostics;
  maxInFlight?: number;
  drainTimeoutMs?: number;
  metadata?: () => { id: string; occurredAt: string };
}): EventPublisher & { stop(this: void): Promise<void> } {
  const { diagnostics, maxInFlight = 128, drainTimeoutMs = 5_000 } = options;
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("Invalid publication capacity");
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0)
    throw new Error("Invalid publication drain timeout");
  const registrations = new Map<string, (typeof options.registrations)[number]>();
  const ids = new Set<string>();
  let hasSubscribers = false;
  for (const registration of options.registrations) {
    const { definition } = registration;
    const key = JSON.stringify([definition.type, definition.version]);
    const existing = registrations.get(key);
    if (existing && existing.definition !== definition)
      throw new Error(
        `Conflicting business event definition: ${definition.type}:${definition.version}`,
      );
    for (const subscriber of registration.subscribers) {
      if (!subscriber.id || ids.has(subscriber.id))
        throw new Error("Business event subscriber IDs must be unique and nonempty");
      ids.add(subscriber.id);
      hasSubscribers = true;
    }
    registrations.set(key, {
      definition,
      subscribers: [...(existing?.subscribers ?? []), ...registration.subscribers],
    });
  }
  const metadata =
    options.metadata ?? (() => ({ id: randomUUID(), occurredAt: new Date().toISOString() }));
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let stopping: Promise<void> | undefined;

  const report = (failure: PublicationFailure) => reportPublicationFailure(diagnostics, failure);

  function publish(fact: EventInput): void {
    if (!hasSubscribers) return;
    let eventType = "unknown";
    let event: PublishedEvent | undefined;
    let stage: PublicationFailureStage = "validation";
    try {
      const registration = registrations.get(JSON.stringify([fact.type, fact.version]));
      if (!registration) throw new Error("Unknown business event type or version");
      const { definition, subscribers } = registration;
      eventType = definition.type;
      if (closed || inFlight.size >= maxInFlight) {
        report({
          eventType,
          subscriberId: "publisher",
          stage: closed ? "closed" : "overload",
          error: new Error(
            closed
              ? "Business event publisher is closed"
              : "Business event publication capacity exceeded",
          ),
        });
        return;
      }
      let parsed: EventInput;
      try {
        parsed = definition.parse(fact);
        if (
          parsed.type !== definition.type ||
          parsed.version !== definition.version ||
          typeof parsed.subjectId !== "string" ||
          !parsed.subjectId ||
          (parsed.actorId !== undefined && typeof parsed.actorId !== "string")
        )
          throw new Error("Invalid event fact");
      } catch {
        // Schema errors can include raw payloads. Do not export those values.
        throw new Error("Business event validation failed");
      }
      if (subscribers.length === 0) return;
      stage = "envelope";
      const envelope = metadata();
      if (
        typeof envelope.id !== "string" ||
        !envelope.id ||
        !Number.isFinite(Date.parse(envelope.occurredAt))
      )
        throw new Error("Invalid business event metadata");
      // All consumers receive independent payloads from the validated producer snapshot.
      // Clone before scheduling any consumer; clone failures must not leak payload values.
      const deliveries = subscribers.map((subscriber) => {
        try {
          return {
            subscriber,
            event: Object.freeze({
              ...structuredClone(parsed),
              id: envelope.id,
              occurredAt: envelope.occurredAt,
            }),
          };
        } catch {
          throw new Error("Business event payload copy failed");
        }
      });
      event = Object.freeze({ ...parsed, id: envelope.id, occurredAt: envelope.occurredAt });
      const accepted = event;
      const work = Promise.all(
        deliveries.map(({ subscriber, event }) =>
          Promise.resolve()
            .then(() => subscriber.enqueue(event))
            .catch((error: unknown) => {
              report({
                eventType,
                eventId: accepted.id,
                subjectId: accepted.subjectId,
                subscriberId: subscriber.id,
                stage: "subscriber",
                error,
              });
            }),
        ),
      ).then(() => {});
      inFlight.add(work);
      // work resolves even when a subscriber rejects; still guard the tracking cleanup.
      void work.then(
        () => inFlight.delete(work),
        () => inFlight.delete(work),
      );
    } catch (error) {
      report({
        eventType,
        eventId: event?.id,
        subjectId: event?.subjectId,
        subscriberId: "publisher",
        stage,
        error,
      });
    }
  }

  /** Closes admission immediately. Waits at most drainTimeoutMs; does not cancel persisted work. */
  function stop(): Promise<void> {
    closed = true;
    stopping ??= new Promise<void>((resolve) => {
      if (inFlight.size === 0) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        report({
          eventType: "unknown",
          subscriberId: "publisher",
          stage: "drain",
          error: new Error("Business event shutdown drain timed out"),
        });
        resolve();
      }, drainTimeoutMs);
      void Promise.allSettled(inFlight).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return stopping;
  }
  return { publish, stop };
}
