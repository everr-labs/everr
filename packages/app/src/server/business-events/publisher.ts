import { randomUUID } from "node:crypto";
import type {
  ApplicationBusinessEvents,
  BusinessEvent,
  BusinessEventFact,
  BusinessEvents,
} from "#app/composition/business-events.ts";

export type PublicationFailureStage =
  | "validation"
  | "envelope"
  | "subscriber"
  | "overload"
  | "closed"
  | "drain";
export interface PublicationFailure {
  /** Always a registered type, or the bounded sentinel "unknown". */
  eventType: string;
  eventId?: string;
  subjectId?: string;
  subscriberId: string;
  stage: PublicationFailureStage;
  error: unknown;
}
export interface PublicationDiagnostics {
  log(failure: PublicationFailure): void | Promise<void>;
  count(failure: PublicationFailure): void | Promise<void>;
}

export interface BusinessEventPublisher extends BusinessEvents {
  /** Closes admission immediately. Waits at most drainTimeoutMs; does not cancel persisted work. */
  stop(this: void): Promise<void>;
}

/** No queue or persistence of its own. Accepted work is bounded, excess facts are lost. */
export function createBusinessEventPublisher(
  options: ApplicationBusinessEvents & {
    diagnostics: PublicationDiagnostics;
    maxInFlight?: number;
    drainTimeoutMs?: number;
    metadata?: () => { id: string; occurredAt: string };
  },
): BusinessEventPublisher {
  const { diagnostics, maxInFlight = 128, drainTimeoutMs = 5_000 } = options;
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("Invalid publication capacity");
  if (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0)
    throw new Error("Invalid publication drain timeout");
  const definitions = [...options.definitions];
  const subscribers = [...options.subscribers];
  const keys = new Set<string>();
  for (const definition of definitions) {
    const key = `${definition.type}:${definition.version}`;
    if (keys.has(key)) throw new Error(`Duplicate business event definition: ${key}`);
    keys.add(key);
  }
  const ids = new Set<string>();
  for (const subscriber of subscribers) {
    if (!subscriber.id || ids.has(subscriber.id))
      throw new Error("Business event subscriber IDs must be unique and nonempty");
    if (!definitions.includes(subscriber.definition))
      throw new Error(`Unregistered business event definition: ${subscriber.id}`);
    ids.add(subscriber.id);
  }
  const metadata =
    options.metadata ?? (() => ({ id: randomUUID(), occurredAt: new Date().toISOString() }));
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let stopping: Promise<void> | undefined;

  // Guard each diagnostic independently, including async diagnostic implementations.
  // A broken logger must not suppress the counter, recurse, or create an unhandled rejection.
  function report(failure: PublicationFailure): void {
    for (const emit of [() => diagnostics.log(failure), () => diagnostics.count(failure)]) {
      try {
        void Promise.resolve(emit()).catch(() => {});
      } catch {
        // Diagnostics are best effort too.
      }
    }
  }

  function publish(fact: BusinessEventFact): void {
    if (subscribers.length === 0) return;
    let eventType = "unknown";
    let event: BusinessEvent | undefined;
    let stage: PublicationFailureStage = "validation";
    try {
      const definition = definitions.find(
        (candidate) => candidate.type === fact.type && candidate.version === fact.version,
      );
      if (!definition) throw new Error("Unknown business event type or version");
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
      let parsed: BusinessEventFact;
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
      stage = "envelope";
      const envelope = metadata();
      if (
        typeof envelope.id !== "string" ||
        !envelope.id ||
        !Number.isFinite(Date.parse(envelope.occurredAt))
      )
        throw new Error("Invalid business event metadata");
      event = Object.freeze({ ...parsed, id: envelope.id, occurredAt: envelope.occurredAt });
      const accepted = event;
      const work = Promise.all(
        subscribers
          .filter((subscriber) => subscriber.definition === definition)
          .map((subscriber) =>
            Promise.resolve()
              .then(() => subscriber.enqueue(accepted))
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
