import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const TRACES_ATTRIBUTE_SOURCES_UI: AttributeSource[] = [
  "resource",
  "span",
];

export const TRACES_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "span", key: "http.route" },
  { source: "span", key: "db.system" },
];

// Each key has a control of its own. service.name and deployment.environment are
// in the top zone of the rail, and service.namespace is in the bottom zone. If
// the attribute picker offered these keys, the user could add a second filter
// for a key that a control already sets.
export const TRACES_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:service.namespace",
  "resource:deployment.environment",
]);
