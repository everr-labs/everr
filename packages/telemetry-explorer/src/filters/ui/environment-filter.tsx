import type { TimeRange } from "@everr/ui/lib/time-range";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { AttributeValueCombobox } from "./attribute-value-combobox";
import { ENVIRONMENT_ATTRIBUTE } from "./dedicated-attributes";

// The dedicated Environment control, shared across the Logs/Errors/Traces filter
// bars. It is sugar over the `deployment.environment` resource attribute: pair it
// with a DedicatedAttributeSection given the same ENVIRONMENT_ATTRIBUTE so the
// value is owned here and hidden from the generic picker.
export function EnvironmentFilter({
  repo,
  domain,
  timeRange,
  attributes,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  attributes: AttributeFilter[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  return (
    <AttributeValueCombobox
      repo={repo}
      domain={domain}
      timeRange={timeRange}
      source={ENVIRONMENT_ATTRIBUTE.source}
      attributeKey={ENVIRONMENT_ATTRIBUTE.key}
      label="Environment"
      placeholder="All environments"
      searchPlaceholder="Search environments..."
      attributes={attributes}
      onChange={onChange}
    />
  );
}
