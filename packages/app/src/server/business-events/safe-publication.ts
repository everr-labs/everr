import type {
  BusinessEventDefinition,
  BusinessEventFact,
  BusinessEvents,
} from "#app/composition/business-events.ts";
import { reportPublicationFailure, type PublicationDiagnostics } from "./diagnostics";
import { publicationDiagnostics } from "./telemetry";

/** Normalize an injected port once, without wrapping or awaiting its source operation. */
export function safeBusinessEvents<F extends BusinessEventFact>(
  publisher: BusinessEvents<F>,
  definitions: readonly BusinessEventDefinition[],
  diagnostics: PublicationDiagnostics = publicationDiagnostics,
): BusinessEvents<F> {
  const types = new Set(definitions.map((definition) => definition.type));
  return {
    publish(fact) {
      let eventType = "unknown";
      try {
        const type = fact.type;
        if (types.has(type)) eventType = type;
      } catch {
        // Malformed runtime input must not break the failure guard itself.
      }
      const failed = () =>
        reportPublicationFailure(diagnostics, {
          eventType,
          subscriberId: "publisher",
          stage: "publication",
          // Injected exceptions can contain profile data or provider response bodies.
          error: new Error("Business event publication failed"),
        });
      try {
        const result = publisher.publish(fact);
        // A runtime adapter can return a rejecting promise despite the void contract.
        void Promise.resolve(result).catch(failed);
      } catch {
        failed();
      }
    },
  };
}
