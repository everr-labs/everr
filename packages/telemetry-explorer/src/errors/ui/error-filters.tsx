import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useId } from "react";
import { DedicatedAttributeSection } from "../../filters/ui/dedicated-attribute-section";
import { ENVIRONMENT_ATTRIBUTE } from "../../filters/ui/dedicated-attributes";
import { EnvironmentFilter } from "../../filters/ui/environment-filter";
import { FilterSidebar } from "../../filters/ui/filter-sidebar";
import type { ErrorsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../data/schemas";
import type { ErrorSort } from "../data/types";
import {
  ERRORS_ATTRIBUTE_SOURCES_UI,
  ERRORS_EXCLUDED_KEYS,
  ERRORS_PROMOTED_ATTRIBUTES,
} from "./error-attribute-config";

export type ErrorFiltersValue = {
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  attributes: AttributeFilter[];
};

export function ErrorFilters({
  repo,
  timeRange,
  value,
  services,
  onChange,
}: {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  value: ErrorFiltersValue;
  services: string[];
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  const orderLabelId = useId();
  const serviceOptions = [
    ...services,
    ...value.service.filter((service) => !services.includes(service)),
  ];
  const serviceFilterOptions = {
    queryKey: ["errors", "service-filter-options", serviceOptions] as const,
    queryFn: async () => serviceOptions,
    select: (data: string[]) => data,
  };

  // "Clear all" resets active filters only. Sort is an ordering preference (it
  // always has a value), and q is owned by the separate search bar, so neither
  // counts toward hasActiveFilters nor is reset by onClear.
  const hasActiveFilters =
    value.service.length > 0 || value.attributes.length > 0;

  return (
    <FilterSidebar
      label="Error filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() => onChange({ service: [], attributes: [] })}
    >
      <div className="flex flex-col gap-1">
        <Label id={orderLabelId} className="text-muted-foreground text-xs">
          Order
        </Label>
        <ToggleGroup
          value={[value.sort]}
          size="lg"
          variant="outline"
          spacing={0}
          className="w-full"
          onValueChange={(next) => {
            const selected = next[0];
            if (selected === "lastSeen" || selected === "count") {
              onChange({ sort: selected });
            }
          }}
          aria-labelledby={orderLabelId}
        >
          <ToggleGroupItem
            value="lastSeen"
            aria-label="Last seen"
            className="flex-1"
          >
            Last seen
          </ToggleGroupItem>
          <ToggleGroupItem value="count" aria-label="Count" className="flex-1">
            Count
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Separator />

      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(nextServices) => onChange({ service: nextServices })}
        options={serviceFilterOptions}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <EnvironmentFilter
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        attributes={value.attributes}
        onChange={(attributes) => onChange({ attributes })}
      />

      <Separator />

      <DedicatedAttributeSection
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        attributes={value.attributes}
        dedicated={[ENVIRONMENT_ATTRIBUTE]}
        promotedAttributes={ERRORS_PROMOTED_ATTRIBUTES}
        excludedKeys={ERRORS_EXCLUDED_KEYS}
        sources={ERRORS_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) => onChange({ attributes })}
      />
    </FilterSidebar>
  );
}
