import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import type { ReactNode } from "react";
import type { MetricType } from "../data/schemas";
import { type MetricCatalogEntry, metricKind } from "../data/types";
import { unitName } from "./format";
import { MetricKindLabel, MetricName } from "./metric-name";

export type MetricLinkRenderProps = {
  metric: string;
  type: MetricType;
  className: string;
  children: ReactNode;
};

const count = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 3,
  notation: "compact",
});

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
        <thead className="bg-background sticky top-0 z-10">
          <tr className="text-muted-foreground border-b text-xs">
            <th className="px-4 py-1.5 text-left font-medium">Metric</th>
            <th className="w-36 px-4 py-1.5 text-left font-medium">Type</th>
            <th className="hidden w-36 px-4 py-1.5 text-left font-medium xl:table-cell">Unit</th>
            <th className="hidden w-28 px-4 py-1.5 text-right font-medium sm:table-cell">
              Data points
            </th>
            <th className="hidden w-28 px-4 py-1.5 text-right font-medium lg:table-cell">
              Last seen
            </th>
          </tr>
        </thead>
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
                      <span
                        className="text-muted-foreground truncate text-xs"
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
                <td
                  className="text-muted-foreground hidden truncate px-4 py-1.5 text-xs xl:table-cell"
                  title={row.unit ? `UCUM unit: ${row.unit}` : undefined}
                >
                  {row.unit ? unitName(row.unit) : "—"}
                </td>
                <td
                  className="text-muted-foreground hidden px-4 py-1.5 text-right text-xs tabular-nums sm:table-cell"
                  title={`${count.format(row.points)} data points`}
                >
                  {compact.format(row.points)}
                </td>
                <td className="text-muted-foreground hidden px-4 py-1.5 text-right text-xs whitespace-nowrap lg:table-cell">
                  {formatRelativeTime(row.lastSeen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
