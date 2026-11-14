// Convert metadata.labels.<k> to everr.label.<k>.
export const ANN_LABEL_PREFIX = "everr.label.";

export const ANN_DISPLAY_NAME = "everr.display.name";
export const ANN_DISPLAY_DESCRIPTION = "everr.display.description";

// "true" on a rule whose resolve says nothing about a fix, such as an error
// no longer counting as new. Its issues are then commented on only when an
// issue closed as done is reopened, never when the alert stops or fires
// again on an issue still open.
export const ANN_ISSUES_QUIET = "everr.issues.quiet";

export const ANN_ALERTING_SUMMARY = "summary";
export const ANN_ALERTING_DESCRIPTION = "description";
export const ANN_ALERTING_LINK_ALERT = "link.alert";
export const ANN_ALERTING_LINK_RUNBOOK = "link.runbook";

const RESERVED_ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  ANN_ALERTING_SUMMARY,
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_ALERT,
  ANN_ALERTING_LINK_RUNBOOK,
]);

function isEverrAnnotationKey(key: string): boolean {
  return key.startsWith("everr.");
}

export function isReservedAnnotationKey(key: string): boolean {
  return isEverrAnnotationKey(key) || RESERVED_ANNOTATION_KEYS.has(key);
}

type PartitionedAnnotations = {
  /** metadata.labels, restored from their `everr.label.` prefix. */
  labels: Record<string, string>;
  /** Free-form `spec.annotations` the author wrote. Nothing generated. */
  custom: Record<string, string>;
};

/**
 * Splits stored annotations into the two categories a reader can act on.
 * `toRuleInput` generates every other key from a field the surface already
 * shows on its own, so listing those back is duplication, not information.
 */
export function partitionAnnotations(
  annotations: Record<string, string> | null | undefined,
): PartitionedAnnotations {
  const labels: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(annotations ?? {})) {
    if (key.startsWith(ANN_LABEL_PREFIX)) {
      labels[key.slice(ANN_LABEL_PREFIX.length)] = value;
    } else if (!isReservedAnnotationKey(key)) {
      custom[key] = value;
    }
  }
  return { labels, custom };
}
