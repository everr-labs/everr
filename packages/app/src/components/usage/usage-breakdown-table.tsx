import { type Column, DataTable } from "@everr/ui/components/data-table";
import { projectToPeriodEnd } from "@/data/usage/forecast";
import {
  formatCount,
  formatUsd,
  USAGE_PRICING,
  usageCosts,
} from "@/data/usage/pricing";
import type { CurrentPeriodUsage } from "@/data/usage/schemas";

interface BreakdownRow {
  signal: string;
  /** $ per 1M items; undefined for the total row. */
  rate?: number;
  count: number;
  cost: number;
  forecastCount: number;
  forecastCost: number;
}

const columns: Column<BreakdownRow>[] = [
  {
    header: "Signal",
    cell: (row) => <span className="font-medium">{row.signal}</span>,
  },
  {
    header: "Price / 1M",
    cell: (row) =>
      row.rate === undefined ? (
        ""
      ) : (
        <span className="font-mono tabular-nums">{formatUsd(row.rate)}</span>
      ),
  },
  {
    header: "Month to date",
    cell: (row) => formatCount(row.count),
  },
  {
    header: "Cost to date",
    cell: (row) => (
      <span className="font-mono font-medium tabular-nums">
        {formatUsd(row.cost)}
      </span>
    ),
  },
  {
    header: "Forecast",
    cell: (row) => formatCount(row.forecastCount),
  },
  {
    header: "Forecast cost",
    cell: (row) => (
      <span className="font-mono font-medium tabular-nums">
        {formatUsd(row.forecastCost)}
      </span>
    ),
  },
];

export function UsageBreakdownTable({ usage }: { usage: CurrentPeriodUsage }) {
  const costs = usageCosts(usage.totals);
  const forecast = projectToPeriodEnd(usage);
  const forecastCosts = usageCosts(forecast);

  const rows: BreakdownRow[] = [
    {
      signal: "Logs",
      rate: USAGE_PRICING.logsPerMillion,
      count: usage.totals.logs,
      cost: costs.logs,
      forecastCount: forecast.logs,
      forecastCost: forecastCosts.logs,
    },
    {
      signal: "Spans",
      rate: USAGE_PRICING.spansPerMillion,
      count: usage.totals.spans,
      cost: costs.spans,
      forecastCount: forecast.spans,
      forecastCost: forecastCosts.spans,
    },
    {
      signal: "Metric datapoints",
      rate: USAGE_PRICING.metricsPerMillion,
      count: usage.totals.metrics,
      cost: costs.metrics,
      forecastCount: forecast.metrics,
      forecastCost: forecastCosts.metrics,
    },
    {
      signal: "Total",
      count: usage.totals.logs + usage.totals.spans + usage.totals.metrics,
      cost: costs.total,
      forecastCount: forecast.logs + forecast.spans + forecast.metrics,
      forecastCost: forecastCosts.total,
    },
  ];

  return (
    <DataTable data={rows} columns={columns} rowKey={(row) => row.signal} />
  );
}
