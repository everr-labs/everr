import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { attributeValuesOptions } from "../../attribute-filter/options";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import { ENVIRONMENT_ATTRIBUTE } from "./dedicated-attributes";

// String-valued Environment selector for the shared Explore topbar. Unlike the
// sidebar's EnvironmentFilter (which reads/writes an AttributeFilter[]), this
// owns a plain string[] because environment is now a first-class shared param.
export function EnvironmentSelect({
  repo,
  domain,
  timeRange,
  values,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <FilterCombobox
      label="Environment"
      values={values}
      onChange={onChange}
      options={{
        ...attributeValuesOptions(
          repo,
          {
            timeRange,
            source: ENVIRONMENT_ATTRIBUTE.source,
            key: ENVIRONMENT_ATTRIBUTE.key,
          },
          { domain },
        ),
        select: (data: string[]) => data,
      }}
      placeholder="All environments"
      searchPlaceholder="Search environments..."
      className="w-45"
    />
  );
}
