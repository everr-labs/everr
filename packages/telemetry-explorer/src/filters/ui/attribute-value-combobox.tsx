import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { attributeValuesOptions } from "../../attribute-filter/options";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter, AttributeSource } from "../../attribute-filter/schemas";

export function AttributeValueCombobox({
  repo,
  domain,
  timeRange,
  source,
  attributeKey,
  label,
  placeholder,
  searchPlaceholder,
  attributes,
  onChange,
}: {
  repo: AttributeRepositoryLike;
  domain: string;
  timeRange: TimeRange;
  source: AttributeSource;
  attributeKey: string;
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  attributes: AttributeFilter[];
  onChange: (next: AttributeFilter[]) => void;
}) {
  const matches = (filter: AttributeFilter) =>
    filter.source === source && filter.key === attributeKey && filter.op === "in";

  const current = attributes.find(matches);
  const values = current?.values ?? [];

  const setValues = (next: string[]) => {
    const others = attributes.filter((filter) => !matches(filter));
    onChange(
      next.length === 0
        ? others
        : [...others, { source, key: attributeKey, op: "in", values: next }],
    );
  };

  const options = {
    ...attributeValuesOptions(repo, { timeRange, source, key: attributeKey }, { domain }),
    select: (data: string[]) => data,
  };

  return (
    <FilterCombobox
      label={label}
      values={values}
      onChange={setValues}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      className="w-full"
    />
  );
}
