// The annotation-key vocabulary shared by the AlertRule schema (which rejects
// reserved keys) and the mapping layer (which generates them). A leaf module:
// mapping imports schema, so the constants must live below both. The SLO
// as-code layer (data/slos) shares the ownership/identity vocabulary below, so
// the keys live here rather than in either kind's mapping module.

// Ownership annotation on a CC-backed as-code resource (rules and SLOs): the
// repoid that owns it. A resource carrying everr.repoid is everr-managed; one
// without it is engine-native and never touched by any reconciler.
//
// Identity (project/slug, live-vs-preview namespace) lives on the CC entity's
// own first-class `name`/`namespace` fields for both rules (see
// data/alerts/mapping.ts's toRuleInput/fromCcRule) and SLOs (see
// data/slos/mapping.ts's toSloInput/fromCcSlo) now, so neither kind writes an
// identity or preview annotation anymore.
export const OWN_REPO = "everr.repoid";
// ANN_PROJECT is write-path-retired for both kinds (project now round-trips
// through the first-class `name`), but stays exported: some downstream
// readers (e.g. the SLO detail route) still parse it off legacy CC data.
export const ANN_PROJECT = "everr.project";
// metadata.labels.<k> → everr.label.<k> (shared by rules and SLOs).
export const ANN_LABEL_PREFIX = "everr.label.";

// spec.display.name / spec.display.description → these annotations, shared
// by rules and SLOs. The notification templates live ONLY under CC's own
// `summary`/`description` keys below (rules stamp their own; SLOs derive
// `summary` from the display name, see data/slos/mapping.ts's toSloInput).
export const ANN_DISPLAY_NAME = "everr.display.name";
export const ANN_DISPLAY_DESCRIPTION = "everr.display.description";

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
