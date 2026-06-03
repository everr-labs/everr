import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const ERRORS_ATTRIBUTE_SOURCES_UI: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export const ERRORS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "host.name" },
];

// service.name backs the Service filter; deployment.environment backs the
// dedicated Environment filter.
export const ERRORS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment",
]);
