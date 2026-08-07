// Generated annotation keys shared by alert and SLO schemas, mappings, and the
// notification dispatcher.

// metadata.labels.<k> → everr.label.<k> (shared by rules and SLOs).
export const ANN_LABEL_PREFIX = "everr.label.";

// Display metadata shared by rules and SLOs.
export const ANN_DISPLAY_NAME = "everr.display.name";
export const ANN_DISPLAY_DESCRIPTION = "everr.display.description";

// Notification content rendered by the dispatcher.
export const ANN_ALERTING_SUMMARY = "summary";
export const ANN_ALERTING_DESCRIPTION = "description";
export const ANN_ALERTING_LINK_ALERT = "link.alert";
export const ANN_ALERTING_LINK_RUNBOOK = "link.runbook";

// Generated keys cannot be supplied through spec.annotations.
export const RESERVED_ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  ANN_ALERTING_SUMMARY,
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
]);

/** True for `everr.`-prefixed annotation keys: internal everr markers, never user metadata. */
export function isEverrAnnotationKey(key: string): boolean {
  return key.startsWith("everr.");
}
