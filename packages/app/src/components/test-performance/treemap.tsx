import { useMemo } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { Badge } from "@/components/ui/badge";
import { ChartEmptyState } from "@/components/ui/chart-helpers";
import type { TestPerfChild } from "@/data/test-performance";
import { formatDurationCompact, testNameLastSegment } from "@/lib/formatting";
import {
  getTestPerfHierarchyKind,
  getTestPerfHierarchyKindBadgeLabel,
  getTestPerfHierarchyKindLabel,
  type TestPerfHierarchyKind,
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
  displayName: string;
  fill: string;
  nodeKind: TestPerfHierarchyKind;
  nodeKindLabel: string;
  nodeKindBadgeLabel: string;
}

function getFailureColor(failureRate: number) {
  if (failureRate >= 20) return "hsl(0 84% 60%)";
  if (failureRate >= 8) return "hsl(38 92% 50%)";
  return "hsl(142 71% 45%)";
}

function TreemapTooltip({
  active,
  payload,
  sizeMetric,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TreemapDatum }>;
  sizeMetric: TreemapSizeMetric;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  const sizeLabel =
    sizeMetric === "avgDuration"
      ? "Average Duration"
      : sizeMetric === "p95Duration"
        ? "P95 Duration"
        : "Failure Rate";

  const sizeValue =
    sizeMetric === "avgDuration"
      ? formatDurationCompact(item.avgDuration, "s")
      : sizeMetric === "p95Duration"
        ? formatDurationCompact(item.p95Duration, "s")
        : `${item.failureRate}%`;

  return (
    <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl min-w-44">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-all font-medium">{item.name}</p>
        <Badge variant="outline" className="shrink-0">
          {item.nodeKindLabel}
        </Badge>
      </div>
      <div className="grid gap-0.5 text-muted-foreground">
        <p>
          Size ({sizeLabel}):{" "}
          <span className="text-foreground font-mono">{sizeValue}</span>
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

function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  depth?: number;
  name?: string;
  displayName?: string;
  avgDuration?: number;
  p95Duration?: number;
  failureRate?: number;
  sizeMetric?: TreemapSizeMetric;
  fill?: string;
  nodeKindBadgeLabel?: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    depth = 0,
    name,
    displayName,
    avgDuration,
    p95Duration,
    failureRate,
    sizeMetric = "avgDuration",
    fill,
    nodeKindBadgeLabel,
  } = props;

  // Recharts treemap may invoke content for root/internal nodes.
  if (depth <= 0 || width <= 0 || height <= 0) return null;

  const label = displayName ?? name ?? "";
  const avg = typeof avgDuration === "number" ? avgDuration : undefined;
  const p95 = typeof p95Duration === "number" ? p95Duration : undefined;
  const rate = typeof failureRate === "number" ? failureRate : undefined;
  const color = fill ?? "hsl(142 71% 45%)";
  const gap = 2;
  const tileX = x + gap / 2;
  const tileY = y + gap / 2;
  const tileWidth = Math.max(0, width - gap);
  const tileHeight = Math.max(0, height - gap);
  const canLabel = tileWidth >= 64 && tileHeight >= 28;
  const kindBadge = nodeKindBadgeLabel ?? "";
  const canShowKindBadge =
    kindBadge.length > 0 && tileWidth >= 82 && tileHeight >= 24;
  const kindBadgeWidth = kindBadge.length * 6 + 14;
  const kindBadgeX = tileX + tileWidth - kindBadgeWidth - 6;

  const sizeText =
    sizeMetric === "avgDuration"
      ? avg !== undefined
        ? `${formatDurationCompact(avg, "s")} avg`
        : undefined
      : sizeMetric === "p95Duration"
        ? p95 !== undefined
          ? `${formatDurationCompact(p95, "s")} p95`
          : undefined
        : rate !== undefined
          ? `${rate}% fail`
          : undefined;

  if (tileWidth <= 0 || tileHeight <= 0) return null;

  return (
    <g>
      <rect
        x={tileX}
        y={tileY}
        width={tileWidth}
        height={tileHeight}
        fill={color}
        style={{ stroke: "hsl(var(--border))" }}
        strokeWidth={1.5}
        rx={2}
        shapeRendering="crispEdges"
      />
      {canShowKindBadge && (
        <>
          <rect
            x={kindBadgeX}
            y={tileY + 6}
            width={kindBadgeWidth}
            height={14}
            fill="rgba(15, 23, 42, 0.24)"
            rx={7}
          />
          <text
            x={kindBadgeX + kindBadgeWidth / 2}
            y={tileY + 15}
            fill="white"
            fontSize={8.5}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            textAnchor="middle"
          >
            {kindBadge}
          </text>
        </>
      )}
      {canLabel && (
        <>
          <text
            x={tileX + 6}
            y={tileY + 14}
            fill="white"
            fontSize={11}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {label}
          </text>
          {tileHeight >= 40 && sizeText && (
            <text
              x={tileX + 6}
              y={tileY + 28}
              fill="white"
              opacity={0.9}
              fontSize={10}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {sizeText}
            </text>
          )}
        </>
      )}
    </g>
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
            nodeKind,
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
            displayName: pkg ? testNameLastSegment(row.name) : row.name,
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
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={treemapData}
          dataKey="value"
          aspectRatio={1}
          type="flat"
          isAnimationActive={false}
          content={<TreemapCell sizeMetric={sizeMetric} />}
          onClick={(node: unknown) => {
            if (!onSelect) return;
            const clicked = node as {
              name?: string;
              payload?: { name?: string };
            };
            const name = clicked?.name ?? clicked?.payload?.name;
            if (name) onSelect(name);
          }}
        >
          <Tooltip content={<TreemapTooltip sizeMetric={sizeMetric} />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
