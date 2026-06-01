import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { ListFilter, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AttributeFilterSection } from "../../attribute-filter/ui/attribute-filter-section";
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

  return (
    <aside
      aria-label="Error filters"
      className="bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <ListFilter className="text-muted-foreground size-3.5" />
        Filter
      </div>

      <FilterCombobox
        label="Service"
        values={value.service}
        onChange={(nextServices) => onChange({ service: nextServices })}
        options={serviceFilterOptions}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-full"
      />

      <Separator />
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
    </aside>
  );
}

export function ErrorSearchForm({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim());
      }}
    >
      <label htmlFor="errors-search" className="sr-only">
        Search errors
      </label>
      <InputGroup className="h-8">
        <InputGroupInput
          id="errors-search"
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Search errors"
        />
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          {value ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              <X />
            </InputGroupButton>
          ) : null}
          <InputGroupButton type="submit" variant="secondary">
            Search
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
