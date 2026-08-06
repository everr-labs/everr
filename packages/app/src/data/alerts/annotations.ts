// The annotation-key vocabulary shared by the AlertRule schema (which rejects
// reserved keys) and the mapping layer (which generates them). A leaf module:
// mapping imports schema, so the constants must live below both. The SLO
// as-code layer (data/slos) shares the ownership/identity vocabulary below, so
// the keys live here rather than in either kind's mapping module.

// metadata.labels.<k> → everr.label.<k> (shared by rules and SLOs).
export const ANN_LABEL_PREFIX = "everr.label.";

// spec.display.name / spec.display.description → these annotations, shared
// by rules and SLOs. The notification templates live ONLY under alerting engine's own
// `summary`/`description` keys below (rules stamp their own; SLOs derive
// `summary` from the display name, see data/slos/mapping.ts's toSloInput).
export const ANN_DISPLAY_NAME = "everr.display.name";
export const ANN_DISPLAY_DESCRIPTION = "everr.display.description";

// alerting engine's dispatcher renders these annotations on notifications: `summary` is the
// headline, `description` an extra body line (both substitute ${<key>} against
// the event's labels, then ${value}, then its evidence columns), and
// `link.alert` / `link.runbook` become View-alert / View-runbook links when
// they are http(s) URLs.
export const ANN_ALERTING_SUMMARY = "summary";
export const ANN_ALERTING_DESCRIPTION = "description";
export const ANN_ALERTING_LINK_ALERT = "link.alert";
export const ANN_ALERTING_LINK_RUNBOOK = "link.runbook";

// Annotation keys reserved for alerting engine-consumable sugar the mapping layer derives
// from other AlertRule fields (notification templates, runbook links, ...).
// A hand-authored spec.annotations entry would silently be clobbered by that
// generated value, so it is rejected at parse time instead.
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
