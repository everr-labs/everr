import type { TimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { ExploreFilterBarView } from "../../filters/ui/explore-filter-bar-view";
import { listServiceIdentitiesOptions } from "../data/options";
import type { TracesRepositoryLike } from "../data/repository";

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function TracesExploreFilters({
  repo,
  timeRange,
  refresh,
  service,
  environment,
  onServiceChange,
  onEnvironmentChange,
}: {
  repo: TracesRepositoryLike;
  timeRange: TimeRange;
  refresh: string;
  service: string[];
  environment: string[];
  onServiceChange: (values: string[]) => void;
  onEnvironmentChange: (values: string[]) => void;
}) {
  const identitiesQuery = useQuery(
    listServiceIdentitiesOptions(repo, { timeRange, refresh }),
  );
  const identities = identitiesQuery.data ?? [];
  const fetched = dedupe(
    identities.map((i) => i.serviceName).filter((n) => n.length > 0),
  );
  const serviceList = [
    ...fetched,
    ...service.filter((s) => !fetched.includes(s)),
  ];

  return (
    <ExploreFilterBarView
      serviceValues={service}
      onServiceChange={onServiceChange}
      serviceOptions={{
        queryKey: ["traces", "explore-service-options", serviceList] as const,
        queryFn: async () => serviceList,
        select: (data: string[]) => data,
      }}
      environmentValues={environment}
      onEnvironmentChange={onEnvironmentChange}
      environmentRepo={repo}
      environmentDomain="traces"
      timeRange={timeRange}
    />
  );
}
