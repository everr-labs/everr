// Convert metadata.labels.<k> to everr.label.<k>.
export const ANN_LABEL_PREFIX = "everr.label.";

export const ANN_DISPLAY_NAME = "everr.display.name";
export const ANN_DISPLAY_DESCRIPTION = "everr.display.description";

export const ANN_ALERTING_SUMMARY = "summary";
export const ANN_ALERTING_DESCRIPTION = "description";
export const ANN_ALERTING_LINK_ALERT = "link.alert";
export const ANN_ALERTING_LINK_RUNBOOK = "link.runbook";

export const RESERVED_ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  ANN_ALERTING_SUMMARY,
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
]);

export function isEverrAnnotationKey(key: string): boolean {
  return key.startsWith("everr.");
}

export function isReservedAnnotationKey(key: string): boolean {
  return isEverrAnnotationKey(key) || RESERVED_ANNOTATION_KEYS.has(key);
}
