import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { withEnvironment } from "../../filters/environment";
import { ExploreFilterBarView } from "../../filters/ui/explore-filter-bar-view";
import { errorServicesOptions } from "../data/options";
import type { ErrorsRepositoryLike } from "../data/repository";

export function ErrorsExploreFilters({
  repo,
  timeRange,
  refresh,
  service,
  environment,
  onServiceChange,
  onEnvironmentChange,
}: {
  repo: ErrorsRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  environment: string[];
  onServiceChange: (values: string[]) => void;
  onEnvironmentChange: (values: string[]) => void;
}) {
  // The error service list is narrowed by the selected environment, matching
  // the prior sidebar behavior (errorServicesOptions takes attributes).
  const servicesQuery = useQuery(
    errorServicesOptions(repo, {
      timeRange,
      refresh,
      attributes: withEnvironment([], environment),
    }),
  );
  const fetched = servicesQuery.data ?? [];
  // Keep selected-but-unlisted services visible (mirrors ErrorFilters).
  const serviceList = [
    ...fetched,
    ...service.filter((s) => !fetched.includes(s)),
  ];

  return (
    <ExploreFilterBarView
      serviceValues={service}
      onServiceChange={onServiceChange}
      serviceOptions={{
        queryKey: ["errors", "explore-service-options", serviceList] as const,
        queryFn: async () => serviceList,
        select: (data: string[]) => data,
      }}
      environmentValues={environment}
      onEnvironmentChange={onEnvironmentChange}
      environmentRepo={repo}
      environmentDomain="errors"
      timeRange={timeRange}
    />
  );
}
