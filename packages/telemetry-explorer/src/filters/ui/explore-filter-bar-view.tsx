import type { TimeRange } from "@everr/ui/lib/time-range";
import type { QueryFunction, QueryKey } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import { EnvironmentSelect } from "./environment-select";
import { ExploreFilterPill } from "./explore-filter-pill";

interface ServiceOptions<TData> {
  queryKey: QueryKey;
  queryFn: QueryFunction<TData>;
  select: (data: TData) => string[];
}

// Presentational Service + Environment row for the Explore topbar. Domain
// wrappers supply the service option-source and the repo/domain for env values.
export function ExploreFilterBarView<TData>({
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
  serviceOptions: ServiceOptions<TData>;
  environmentValues: string[];
  onEnvironmentChange: (values: string[]) => void;
  environmentRepo: AttributeRepositoryLike;
  environmentDomain: string;
  timeRange: TimeRange;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ExploreFilterPill
        label="Service"
        icon={Boxes}
        values={serviceValues}
        onChange={onServiceChange}
        options={serviceOptions}
        placeholder="All services"
        searchPlaceholder="Search services..."
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
