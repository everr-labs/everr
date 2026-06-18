import type { AttributeFilter } from "../attribute-filter/schemas";
import { ENVIRONMENT_ATTRIBUTE } from "./ui/dedicated-attributes";

// Build the dedicated environment AttributeFilter, or null when nothing is
// selected. Environment is sugar over the `deployment.environment` resource
// attribute, so this is what gets merged into query attributes.
export function environmentFilter(
  environment: string[],
): AttributeFilter | null {
  if (environment.length === 0) return null;
  return {
    source: ENVIRONMENT_ATTRIBUTE.source,
    key: ENVIRONMENT_ATTRIBUTE.key,
    op: "in",
    values: environment,
  };
}

// Merge the shared environment selection into a domain's attribute filters at
// query-construction time. Returns the original reference unchanged when no
// environment is selected so query keys stay stable.
export function withEnvironment(
  attributes: AttributeFilter[],
  environment: string[],
): AttributeFilter[] {
  const env = environmentFilter(environment);
  return env ? [...attributes, env] : attributes;
}
