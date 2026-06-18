import type { TimeRange } from "@everr/ui/lib/time-range";
import { ExploreFilterBarView } from "../../filters/ui/explore-filter-bar-view";
import { logServiceFilterOptions } from "../data/options";
import type { LogsRepositoryLike } from "../data/repository";

export function LogsExploreFilters({
  repo,
  timeRange,
  service,
  environment,
  onServiceChange,
  onEnvironmentChange,
}: {
  repo: LogsRepositoryLike;
  timeRange: TimeRange;
  service: string[];
  environment: string[];
  onServiceChange: (values: string[]) => void;
  onEnvironmentChange: (values: string[]) => void;
}) {
  return (
    <ExploreFilterBarView
      serviceValues={service}
      onServiceChange={onServiceChange}
      serviceOptions={logServiceFilterOptions(repo, { timeRange })}
      environmentValues={environment}
      onEnvironmentChange={onEnvironmentChange}
      environmentRepo={repo}
      environmentDomain="logs"
      timeRange={timeRange}
    />
  );
}
