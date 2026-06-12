import { Badge } from "@everr/ui/components/badge";
import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import { formatDurationCompact } from "@everr/ui/lib/formatting";
import { useMemo } from "react";
import { TreemapChart } from "@/components/dashboards/visualizations/treemap/treemap-chart";
import type { TestPerfChild } from "@/data/test-performance/children";
import { testNameLastSegment } from "@/lib/formatting";
import {
  getTestPerfHierarchyKind,
  getTestPerfHierarchyKindBadgeLabel,
  getTestPerfHierarchyKindLabel,
} from "./hierarchy-kind";

export type TreemapSizeMetric = "avgDuration" | "p95Duration" | "failureRate";

interface TestPerfTreemapProps {
  data: TestPerfChild[];
  pkg?: string;
  onSelect?: (name: string) => void;
  sizeMetric?: TreemapSizeMetric;
}

interface TreemapDatum extends TestPerfChild {
  value: number;
  label: string;
  fill: string;
  nodeKindLabel: string;
  nodeKindBadgeLabel: string;
}

function getFailureColor(failureRate: number) {
  if (failureRate >= 20) return "hsl(0 84% 60%)";
  if (failureRate >= 8) return "hsl(38 92% 50%)";
  return "hsl(142 71% 45%)";
}

const SIZE_METRIC_LABEL: Record<TreemapSizeMetric, string> = {
  avgDuration: "Average Duration",
  p95Duration: "P95 Duration",
  failureRate: "Failure Rate",
};

function sizeMetricValue(item: TreemapDatum, sizeMetric: TreemapSizeMetric) {
  return sizeMetric === "avgDuration"
    ? formatDurationCompact(item.avgDuration, "s")
    : sizeMetric === "p95Duration"
      ? formatDurationCompact(item.p95Duration, "s")
      : `${item.failureRate}%`;
}

function tileSizeText(item: TreemapDatum, sizeMetric: TreemapSizeMetric) {
  return sizeMetric === "avgDuration"
    ? `${formatDurationCompact(item.avgDuration, "s")} avg`
    : sizeMetric === "p95Duration"
      ? `${formatDurationCompact(item.p95Duration, "s")} p95`
      : `${item.failureRate}% fail`;
}

function TreemapTooltip({
  item,
  sizeMetric,
}: {
  item: TreemapDatum;
  sizeMetric: TreemapSizeMetric;
}) {
  return (
    <div className="min-w-44">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-all font-medium">{item.name}</p>
        <Badge variant="outline" className="shrink-0">
          {item.nodeKindLabel}
        </Badge>
      </div>
      <div className="grid gap-0.5 text-muted-foreground">
        <p>
          Size ({SIZE_METRIC_LABEL[sizeMetric]}):{" "}
          <span className="text-foreground font-mono">
            {sizeMetricValue(item, sizeMetric)}
          </span>
        </p>
        <p>
          Failure Rate:{" "}
          <span className="text-foreground font-mono">{item.failureRate}%</span>
        </p>
        <p>
          Avg:{" "}
          <span className="text-foreground font-mono">
            {formatDurationCompact(item.avgDuration, "s")}
          </span>
        </p>
        <p>
          P95:{" "}
          <span className="text-foreground font-mono">
            {formatDurationCompact(item.p95Duration, "s")}
          </span>
        </p>
      </div>
    </div>
  );
}

export function TestPerfTreemap({
  data,
  pkg,
  onSelect,
  sizeMetric = "avgDuration",
}: TestPerfTreemapProps) {
  const treemapData = useMemo<TreemapDatum[]>(
    () =>
      data
        .map((row) => {
          const nodeKind = getTestPerfHierarchyKind(row, pkg);

          return {
            ...row,
            nodeKindLabel: getTestPerfHierarchyKindLabel(nodeKind),
            nodeKindBadgeLabel: getTestPerfHierarchyKindBadgeLabel(nodeKind),
            value: Math.max(
              sizeMetric === "avgDuration"
                ? row.avgDuration
                : sizeMetric === "p95Duration"
                  ? row.p95Duration
                  : row.failureRate,
              0.001,
            ),
            label: pkg ? testNameLastSegment(row.name) : row.name,
            fill: getFailureColor(row.failureRate),
          };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 80),
    [data, pkg, sizeMetric],
  );

  if (treemapData.length === 0) {
    return <ChartEmptyState message="No test hierarchy data available" />;
  }

  return (
    <div className="h-[360px] w-full">
      <TreemapChart
        data={treemapData}
        aspectRatio={1}
        tileValueText={(item) => tileSizeText(item, sizeMetric)}
        tileBadgeText={(item) => item.nodeKindBadgeLabel}
        renderTooltip={(item) => (
          <TreemapTooltip item={item} sizeMetric={sizeMetric} />
        )}
        onSelectTile={onSelect && ((item) => onSelect(item.name))}
      />
    </div>
  );
}
