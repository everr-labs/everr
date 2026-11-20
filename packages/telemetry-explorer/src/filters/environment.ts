import type { AttributeFilter } from "../attribute-filter/schemas";
import { ENVIRONMENT_ATTRIBUTE } from "./ui/dedicated-attributes";

// Merge the shared environment selection into a domain's attribute filters at
// query-construction time. Environment is sugar over the
// `deployment.environment.name` resource attribute. Returns the original
// reference unchanged when no environment is selected so query keys stay stable.
export function withEnvironment(
  attributes: AttributeFilter[],
  environment: string[],
): AttributeFilter[] {
  if (environment.length === 0) return attributes;
  return [
    ...attributes,
    {
      source: ENVIRONMENT_ATTRIBUTE.source,
      key: ENVIRONMENT_ATTRIBUTE.key,
      op: "in",
      values: environment,
    },
  ];
}
