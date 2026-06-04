import type { AttributeSource } from "../../attribute-filter/schemas";
import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

export const LOGS_ATTRIBUTE_SOURCES_UI: AttributeSource[] = [
  "resource",
  "log",
  "scope",
];

export const LOGS_PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "host.name" },
];

// service.name backs the dedicated Service filter, so it's redundant as a chip.
// deployment.environment is also excluded, but that is derived from the
// dedicated-attribute list passed to DedicatedAttributeSection, not listed here.
export const LOGS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
]);
