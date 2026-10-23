import type {
  BusinessEvent,
  BusinessEventDefinition,
  BusinessEventFact,
  BusinessEventSubscriber,
} from "#app/composition/business-events.ts";

/** Preserve the feature's payload type at registration, erasing it only for routing. */
export function businessEventSubscriber<F extends BusinessEventFact>(
  definition: BusinessEventDefinition<F>,
  subscriber: { id: string; enqueue: (event: BusinessEvent<F>) => void | Promise<void> },
): BusinessEventSubscriber {
  return {
    id: subscriber.id,
    definition,
    enqueue({ id, occurredAt, ...fact }) {
      return subscriber.enqueue({
        ...definition.parse(fact),
        id,
        occurredAt,
      });
    },
  };
}
