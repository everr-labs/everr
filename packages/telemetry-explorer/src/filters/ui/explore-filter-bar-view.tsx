import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import type { TimeRange } from "@everr/ui/lib/time-range";
import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import { EnvironmentSelect } from "./environment-select";

interface ServiceOptions {
  queryKey: QueryKey;
  queryFn: QueryFunction<string[]>;
  select: (data: string[]) => string[];
}

// Presentational Service + Environment row for the Explore topbar. Domain
// wrappers supply the service option-source and the repo/domain for env values.
export function ExploreFilterBarView({
  serviceValues,
  onServiceChange,
  serviceOptions,
  environmentValues,
  onEnvironmentChange,
  environmentRepo,
  environmentDomain,
  timeRange,
}: {
  serviceValues: string[];
  onServiceChange: (values: string[]) => void;
  serviceOptions: ServiceOptions;
  environmentValues: string[];
  onEnvironmentChange: (values: string[]) => void;
  environmentRepo: AttributeRepositoryLike;
  environmentDomain: string;
  timeRange: TimeRange;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <FilterCombobox
        label="Service"
        values={serviceValues}
        onChange={onServiceChange}
        options={serviceOptions}
        placeholder="All services"
        searchPlaceholder="Search services..."
        className="w-45"
      />
      <EnvironmentSelect
        repo={environmentRepo}
        domain={environmentDomain}
        timeRange={timeRange}
        values={environmentValues}
        onChange={onEnvironmentChange}
      />
    </div>
  );
}
