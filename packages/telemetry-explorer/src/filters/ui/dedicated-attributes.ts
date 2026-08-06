import type { PromotedAttribute } from "../../attribute-filter/ui/attribute-meta";

// Environment is a control for this resource attribute. The top zone of the rail
// keeps the selection in its own search param, and `withEnvironment` adds it to
// the query attributes. The excluded-keys set of each domain also names this
// key, so the attribute picker cannot offer a second filter for it.
export const ENVIRONMENT_ATTRIBUTE: PromotedAttribute = {
  source: "resource",
  key: "deployment.environment",
};
