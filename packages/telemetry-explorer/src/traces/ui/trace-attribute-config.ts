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

// service.name backs the Service filter; service.namespace backs the Namespace
// filter; deployment.environment backs the dedicated Environment filter.
export const TRACES_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:service.namespace",
  "resource:deployment.environment",
]);
