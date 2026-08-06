import { Label } from "@everr/ui/components/label";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { Boxes, Layers } from "lucide-react";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import {
  unionEnvironmentOptions,
  unionServiceOptions,
} from "../data/explore-filter-options";
import { ExploreFilterPill } from "./explore-filter-pill";

// The top zone of the Explore rail. It holds the two filters that stay set when
// the user moves between Logs, Errors and Traces.
//
// Each option list is the union of the logs values and the traces values. The
// choices are then the same on every Explore page, because the two values are
// shared search params. Errors are exception logs, which are a subset of logs,
// so the union already includes them.
//
// Each control fills the width of the rail and has a label, like every other
// section of the rail.
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
  // A list, and not two blocks of markup, so that the two filters stay the same.
  // They use one control with different words, and the user reads them as a
  // pair.
  const filters = [
    {
      label: "Service",
      icon: Boxes,
      values: service,
      onChange: onServiceChange,
      options: unionServiceOptions(logsRepo, tracesRepo, {
        timeRange,
        selected: service,
      }),
      placeholder: "All services",
      searchPlaceholder: "Search services...",
    },
    {
      label: "Environment",
      icon: Layers,
      values: environment,
      onChange: onEnvironmentChange,
      options: unionEnvironmentOptions(logsRepo, tracesRepo, {
        timeRange,
        selected: environment,
      }),
      placeholder: "All environments",
      searchPlaceholder: "Search environments...",
    },
  ];

  return (
    <>
      {filters.map(({ label, ...pill }) => (
        <div key={label} className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-xs">{label}</Label>
          <ExploreFilterPill
            label={label}
            {...pill}
            className="w-full max-w-none"
          />
        </div>
      ))}
    </>
  );
}

// The number of top-zone filters that narrow the results. This gives the count
// on the "Filters" button, which replaces the rail in a narrow window.
export function countPersistentFilters(
  service: string[],
  environment: string[],
): number {
  return (service.length > 0 ? 1 : 0) + (environment.length > 0 ? 1 : 0);
}
