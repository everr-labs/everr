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
import type { ErrorSort, ErrorStatus } from "../data/types";
import {
  ERROR_STATUS_LABELS,
  ERROR_STATUSES,
  isErrorStatus,
} from "../data/types";
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
  /** Absent on surfaces without triage capability (no Status filter shown). */
  status?: ErrorStatus[];
  attributes: AttributeFilter[];
};

function ServiceAndEnvironment({
  services,
  value,
  repo,
  timeRange,
  onChange,
}: {
  services: string[];
  value: ErrorFiltersValue;
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
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
    <>
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
    </>
  );
}

export function ErrorFilters({
  repo,
  timeRange,
  value,
  services = [],
  hideSharedFilters = false,
  showStatus = false,
  onChange,
}: {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  value: ErrorFiltersValue;
  services?: string[];
  hideSharedFilters?: boolean;
  /** Triage surfaces only; local/desktop Errors carry no Status yet. */
  showStatus?: boolean;
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  const orderLabelId = useId();
  const statusLabelId = useId();

  // "Clear all" resets active filters only. Sort is an ordering preference (it
  // always has a value), and q is owned by the separate search bar, so neither
  // counts toward hasActiveFilters nor is reset by onClear. When the service
  // filter is shared (rendered in the topbar — hideSharedFilters), it is owned
  // there too: excluded from hasActiveFilters and left untouched by onClear.
  const hasActiveFilters =
    (!hideSharedFilters && value.service.length > 0) ||
    (showStatus && (value.status?.length ?? 0) > 0) ||
    value.attributes.length > 0;

  return (
    <FilterSidebar
      label="Error filters"
      hasActiveFilters={hasActiveFilters}
      onClear={() =>
        onChange({
          attributes: [],
          ...(showStatus ? { status: [] } : {}),
          ...(hideSharedFilters ? {} : { service: [] }),
        })
      }
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

      {showStatus && (
        <>
          <div className="flex flex-col gap-1">
            <Label id={statusLabelId} className="text-muted-foreground text-xs">
              Status
            </Label>
            <ToggleGroup
              multiple
              value={value.status ?? []}
              size="lg"
              variant="outline"
              spacing={0}
              className="w-full"
              onValueChange={(next) =>
                onChange({ status: next.filter(isErrorStatus) })
              }
              aria-labelledby={statusLabelId}
            >
              {ERROR_STATUSES.map((status) => (
                <ToggleGroupItem
                  key={status}
                  value={status}
                  aria-label={ERROR_STATUS_LABELS[status]}
                  className="flex-1"
                >
                  {ERROR_STATUS_LABELS[status]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground text-xs">
              None selected shows every status.
            </p>
          </div>

          <Separator />
        </>
      )}

      {!hideSharedFilters && (
        <ServiceAndEnvironment
          services={services}
          value={value}
          repo={repo}
          timeRange={timeRange}
          onChange={onChange}
        />
      )}

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
