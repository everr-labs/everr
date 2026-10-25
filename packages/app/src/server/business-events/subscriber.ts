import type {
  BusinessEventDefinition,
  BusinessEventSubscriber,
} from "#app/composition/business-events.ts";

/** Infer consumer payloads from the feature definition used for publication validation. */
export function businessEventRegistration<D extends BusinessEventDefinition>(
  definition: D,
  ...subscribers: readonly BusinessEventSubscriber<NoInfer<ReturnType<D["parse"]>>>[]
) {
  return { definition, subscribers };
}
