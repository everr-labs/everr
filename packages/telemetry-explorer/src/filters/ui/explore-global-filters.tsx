import type { TimeRange } from "@everr/ui/lib/time-range";
import { Boxes, Layers } from "lucide-react";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import {
  unionEnvironmentOptions,
  unionServiceOptions,
} from "../data/explore-filter-options";
import { ExploreFilterPill } from "./explore-filter-pill";

// The Explore topbar's global Service + Environment filters. Unlike the previous
// per-view wrappers, the option lists are the UNION across logs and traces so
// the choices are identical on every Explore view (the values are shared search
// params that persist across Logs/Errors/Traces). Errors are exception logs — a
// subset of logs — so logs ∪ traces already covers them.
export function ExploreGlobalFilters({
  logsRepo,
  tracesRepo,
  timeRange,
  service,
  environment,
  onServiceChange,
  onEnvironmentChange,
}: {
  logsRepo: LogsRepositoryLike;
  tracesRepo: TracesRepositoryLike;
  timeRange: TimeRange;
  service: string[];
  environment: string[];
  onServiceChange: (values: string[]) => void;
  onEnvironmentChange: (values: string[]) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ExploreFilterPill
        label="Service"
        icon={Boxes}
        values={service}
        onChange={onServiceChange}
        options={unionServiceOptions(logsRepo, tracesRepo, {
          timeRange,
          selected: service,
        })}
        placeholder="All services"
        searchPlaceholder="Search services..."
      />
      <ExploreFilterPill
        label="Environment"
        icon={Layers}
        values={environment}
        onChange={onEnvironmentChange}
        options={unionEnvironmentOptions(logsRepo, tracesRepo, {
          timeRange,
          selected: environment,
        })}
        placeholder="All environments"
        searchPlaceholder="Search environments..."
      />
    </div>
  );
}
