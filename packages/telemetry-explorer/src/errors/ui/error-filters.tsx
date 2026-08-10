import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { type ReactNode, useId } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
import { ExploreFilterRail } from "../../filters/ui/explore-filter-rail";
import { FilterSearchBar } from "../../filters/ui/filter-search-bar";
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
  persistentFilters,
  persistentFilterCount = 0,
  onChange,
}: {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  value: ErrorFiltersValue;
  // The top zone of the rail: Service and Environment. The host app supplies it.
  persistentFilters?: ReactNode;
  persistentFilterCount?: number;
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  const orderLabelId = useId();

  // Sort sets an order and does not filter. It always has a value, so it never
  // counts as active, and "Clear page filters" does not change it.
  const pageFilterCount =
    (value.q.length > 0 ? 1 : 0) + value.attributes.length;

  return (
    <ExploreFilterRail
      label="Error filters"
      persistentFilters={persistentFilters}
      persistentFilterCount={persistentFilterCount}
      pageFilterCount={pageFilterCount}
      onClear={() => onChange({ q: "", attributes: [] })}
    >
      <FilterSearchBar
        id="errors-search"
        label="Search"
        showLabel
        value={value.q}
        onChange={(q) => onChange({ q })}
        placeholder="Search errors"
      />

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

      <AttributeFilterSection
        repo={repo}
        domain="errors"
        timeRange={timeRange}
        attributes={value.attributes}
        promotedAttributes={ERRORS_PROMOTED_ATTRIBUTES}
        excludedKeys={ERRORS_EXCLUDED_KEYS}
        sources={ERRORS_ATTRIBUTE_SOURCES_UI}
        onChange={(attributes) => onChange({ attributes })}
      />
    </ExploreFilterRail>
  );
}
