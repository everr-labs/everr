// The annotation-key vocabulary shared by the AlertRule schema (which rejects
// reserved keys) and the mapping layer (which generates them). A leaf module:
// mapping imports schema, so the constants must live below both. The SLO
// as-code layer (data/slos) shares the ownership/identity vocabulary below, so
// the keys live here rather than in either kind's mapping module.

// Ownership annotations on a CC-backed as-code resource (rules and SLOs): the
// resource's as-code name and the repoid that owns it. A resource carrying
// everr.repoid is everr-managed; one without it is engine-native and never
// touched by any reconciler.
//
// OWN_NAME / OWN_PREVIEW / ANN_PROJECT are write-path-retired for alerts:
// identity (project/slug, live-vs-preview namespace) now lives on the CC
// rule's own first-class `name`/`namespace` fields (see
// data/alerts/mapping.ts's toRuleInput/fromCcRule), so alerts never write
// these annotations anymore. They are kept here (not deleted) because
// data/slos/* still writes and reads them; Tasks 4-5 retire the SLO side.
export const OWN_NAME = "everr.name";
export const OWN_REPO = "everr.repoid";
// The preview registry id (previews.id) owning a preview resource. Live
// resources never carry it: it is the live/preview namespace discriminator on
// CC-backed resources, the CC analogue of the Postgres resource tables'
// preview_id column.
export const OWN_PREVIEW = "everr.preview";
// The declared metadata.project, stored only when the document sets it (SLOs;
// resources without it surface under the "default" project). Recorded verbatim
// so the reconstructed document round-trips exactly.
export const ANN_PROJECT = "everr.project";
// metadata.labels.<k> → everr.label.<k> (shared by rules and SLOs).
export const ANN_LABEL_PREFIX = "everr.label.";

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
