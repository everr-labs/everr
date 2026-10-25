import type { EventDefinition, EventSubscriber } from "#app/composition/events.ts";

/** Infer consumer payloads from the feature definition used for publication validation. */
export function eventRegistration<D extends EventDefinition>(
  definition: D,
  ...subscribers: readonly EventSubscriber<NoInfer<ReturnType<D["parse"]>>>[]
) {
  return { definition, subscribers };
}
