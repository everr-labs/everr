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

// The top zone of the rail sets both keys. service.name is the Service filter and
// deployment.environment is the Environment filter, and each keeps its value in
// its own search param. If the attribute picker offered these keys, the user
// could add a second filter for a key that a control already sets.
export const LOGS_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "resource:service.name",
  "resource:deployment.environment",
]);
