import { ExploreGlobalFilters } from "@everr/telemetry-explorer/filters";
import { LogsRepository } from "@everr/telemetry-explorer/logs";
import { TracesRepository } from "@everr/telemetry-explorer/traces";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { useNavigate } from "@tanstack/react-router";
import { localSqlClient } from "../logs/local-sql-client";

// The option lists for Service and Environment are the union of the logs values
// and the traces values. The lists are then the same on every Explore page.
// These two repositories supply the option lists only. Each page uses its own
// repository for the data.
const filterLogsRepo = new LogsRepository(localSqlClient);
const filterTracesRepo = new TracesRepository(localSqlClient);

/**
 * The top zone of the Explore filter rail.
 *
 * Each Explore page receives this component and puts it above the divider in its
 * rail. Service and Environment are search params that the pages share, so they
 * stay set when the user moves between Logs, Errors and Traces. This is why they
 * are separate from the filters of the page.
 *
 * The navigation is in this component and not in each page. The three call sites
 * then differ only in the route that they name.
 */
export function ExplorePersistentFilters({
  to,
  timeRange,
  service,
  environment,
}: {
  to: "/logs" | "/errors" | "/traces";
  timeRange: TimeRange;
  service: string[];
  environment: string[];
}) {
  const navigate = useNavigate();

  return (
    <ExploreGlobalFilters
      logsRepo={filterLogsRepo}
      tracesRepo={filterTracesRepo}
      timeRange={timeRange}
      service={service}
      environment={environment}
      onServiceChange={(values) =>
        navigate({
          to,
          search: (prev) => ({ ...prev, service: values }),
          replace: true,
        })
      }
      onEnvironmentChange={(values) =>
        navigate({
          to,
          search: (prev) => ({ ...prev, environment: values }),
          replace: true,
        })
      }
    />
  );
}
