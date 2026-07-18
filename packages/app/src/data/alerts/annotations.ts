// The annotation-key vocabulary shared by the AlertRule schema (which rejects
// reserved keys) and the mapping layer (which generates them). A leaf module:
// mapping imports schema, so the constants must live below both.

// CC's dispatcher renders these annotations on notifications: `summary` is the
// headline, `description` an extra body line (both substitute ${<key>} against
// the event's labels, then ${value}, then its evidence columns), and
// `link.alert` / `link.runbook` become View-alert / View-runbook links when
// they are http(s) URLs.
export const ANN_CC_SUMMARY = "summary";
export const ANN_CC_DESCRIPTION = "description";
export const ANN_CC_LINK_ALERT = "link.alert";
export const ANN_CC_LINK_RUNBOOK = "link.runbook";

// Annotation keys reserved for CC-consumable sugar the mapping layer derives
// from other AlertRule fields (notification templates, runbook links, ...).
// A hand-authored spec.annotations entry would silently be clobbered by that
// generated value, so it is rejected at parse time instead.
export const RESERVED_ANNOTATION_KEYS: ReadonlySet<string> = new Set([
  ANN_CC_SUMMARY,
  ANN_CC_DESCRIPTION,
  ANN_CC_LINK_ALERT,
  ANN_CC_LINK_RUNBOOK,
]);

/** True for `everr.`-prefixed annotation keys: internal everr markers, never user metadata. */
export function isEverrAnnotationKey(key: string): boolean {
  return key.startsWith("everr.");
}
