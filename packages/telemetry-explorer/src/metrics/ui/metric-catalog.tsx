import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import type { ReactNode } from "react";
import type { MetricType } from "../data/schemas";
import { METRIC_LIST_LIMIT, type MetricCatalogEntry, metricKind } from "../data/types";
import { formatCompact, formatCount, unitName } from "./format";
import { MetricKindLabel, MetricName } from "./metric-name";

export type MetricLinkRenderProps = {
  metric: string;
  type: MetricType;
  className: string;
  children: ReactNode;
};

export function MetricCatalog({
  rows,
  isPending,
  error,
  onRetry,
  empty,
  renderMetricLink,
}: {
  rows: MetricCatalogEntry[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  empty: ReactNode;
  renderMetricLink: (props: MetricLinkRenderProps) => ReactNode;
}) {
  if (isPending) return <CatalogSkeleton />;
  if (error) {
    return <RetryError title="Couldn't load metrics" message={error.message} onRetry={onRetry} />;
  }
  if (rows.length === 0) return empty;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full table-fixed text-sm">
        <CatalogHead />
        <tbody>
          {rows.map((row) => {
            return (
              <tr key={`${row.type}:${row.name}`} className="hover:bg-muted/50 relative border-b">
                <td className="px-4 py-1.5">
                  <div className="flex min-w-0 flex-col">
                    {renderMetricLink({
                      metric: row.name,
                      type: row.type,
                      // The link covers the row, so the whole row opens the metric.
                      className:
                        "truncate font-mono text-[13px] focus-visible:underline focus-visible:outline-none after:absolute after:inset-0",
                      children: <MetricName name={row.name} />,
                    })}
                    {row.description ? (
                      // Positioned, so it sits above the link's cover and
                      // shows its title on hover.
                      <span
                        className="text-muted-foreground relative truncate text-xs"
                        title={row.description}
                      >
                        {row.description}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-1.5">
                  <MetricKindLabel kind={metricKind(row.type, row.isMonotonic)} />
                </td>
                <td className="text-muted-foreground hidden truncate px-4 py-1.5 text-xs xl:table-cell">
                  {row.unit ? (
                    <span className="relative" title={`UCUM unit: ${row.unit}`}>
                      {unitName(row.unit)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="text-muted-foreground hidden px-4 py-1.5 text-right text-xs tabular-nums sm:table-cell">
                  <span className="relative" title={`${formatCount(row.points)} data points`}>
                    {formatCompact(row.points)}
                  </span>
                </td>
                <td className="text-muted-foreground hidden px-4 py-1.5 text-right text-xs whitespace-nowrap lg:table-cell">
                  {formatRelativeTime(row.lastSeen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length >= METRIC_LIST_LIMIT ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          {`Showing the first ${formatCount(METRIC_LIST_LIMIT)} metrics by name. Search to find the rest.`}
        </p>
      ) : null}
    </div>
  );
}

function CatalogHead() {
  return (
    <thead className="bg-background sticky top-0 z-10">
      <tr className="text-muted-foreground border-b text-xs">
        <th className="px-4 py-1.5 text-left font-medium">Metric</th>
        <th className="w-36 px-4 py-1.5 text-left font-medium">Type</th>
        <th className="hidden w-36 px-4 py-1.5 text-left font-medium xl:table-cell">Unit</th>
        <th className="hidden w-28 px-4 py-1.5 text-right font-medium sm:table-cell">
          Data points
        </th>
        <th className="hidden w-28 px-4 py-1.5 text-right font-medium lg:table-cell">Last seen</th>
      </tr>
    </thead>
  );
}

/** The catalog's own table: its header, then rows on its columns at a metric
 *  name's line height (a described metric adds a second line when loaded). */
function CatalogSkeleton() {
  return (
    <div aria-hidden className="min-h-0 flex-1 overflow-hidden">
      <table className="w-full table-fixed text-sm">
        <CatalogHead />
        <tbody>
          {Array.from({ length: 12 }, (_, i) => (
            <tr key={i} className="border-b">
              <td className="px-4 py-1.5">
                <div className="flex h-5 items-center">
                  <Skeleton
                    className="h-3 rounded-sm"
                    style={{ width: `${45 + ((i * 13) % 35)}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-1.5">
                <Skeleton className="h-3 w-16 rounded-sm" />
              </td>
              <td className="hidden px-4 py-1.5 xl:table-cell">
                <Skeleton className="h-3 w-12 rounded-sm" />
              </td>
              <td className="hidden px-4 py-1.5 sm:table-cell">
                <Skeleton className="ml-auto h-3 w-10 rounded-sm" />
              </td>
              <td className="hidden px-4 py-1.5 lg:table-cell">
                <Skeleton className="ml-auto h-3 w-14 rounded-sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
