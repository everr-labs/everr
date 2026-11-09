import { chartLabel } from "@everr/ui/lib/chart-label";
import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { readableForeground } from "@everr/ui/lib/contrast";
import type { TreemapSeriesOption } from "echarts/charts";
import { TreemapChart } from "echarts/charts";
import type { ECElementEvent } from "echarts/core";
import * as echarts from "echarts/core";
import { LayoutGrid } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEChart } from "@everr/ui/hooks/use-echart";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import type { TreemapSpec } from "./spec";
import { buildTreemapTiles, type TreemapTile } from "./treemap-data";
import { PanelEmptyState } from "../panel-empty-state";

echarts.use([TreemapChart]);

const NO_TILES: TreemapTile[] = [];
const TILE_GAP = 2;
const LABEL_PADDING = 6;

export function TreemapVisualization({ spec, data }: VisualizationProps<TreemapSpec>) {
  const formatter = useMemo(() => createValueFormatter(spec.valueFormat), [spec.valueFormat]);
  const model = useMemo(() => (data ? buildTreemapTiles(data, spec) : null), [data, spec]);
  const tiles = model?.tiles ?? NO_TILES;

  const chartElementRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const clearHover = useCallback(() => setHover(null), []);
  const mounted = useEChart(chartElementRef, tiles.length > 0, clearHover);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;

  useEffect(() => {
    if (!chart || !theme) return;
    const series: TreemapSeriesOption = {
      type: "treemap",
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      // A flat map: no zooming into tiles, no breadcrumb trail.
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      squareRatio: 4 / 3,
      itemStyle: { borderColor: theme.cardColor, borderWidth: 0, gapWidth: TILE_GAP },
      emphasis: { disabled: true },
      data: tiles.map((tile) => ({
        name: tile.name,
        value: tile.value,
        itemStyle: { color: tile.color },
        label: {
          // Tiles are opaque, so the label sits on the tile color alone.
          color: readableForeground(tile.color)?.color ?? theme.foregroundColor,
        },
      })),
      label: {
        show: true,
        position: "insideTopLeft",
        padding: LABEL_PADDING,
        overflow: "truncate",
        fontFamily: theme.fontFamily,
        formatter: ({ name, value }) =>
          spec.showValues && typeof value === "number"
            ? `{name|${name}}\n{value|${formatter.format(value)}}`
            : `{name|${name}}`,
        rich: {
          name: { fontSize: 11, lineHeight: 14 },
          value: { fontSize: 10, lineHeight: 14, opacity: 0.85 },
        },
      },
    };
    chart.setOption({ animation: false, series: [series] }, { notMerge: true });
  }, [chart, theme, tiles, spec.showValues, formatter]);

  useEffect(() => {
    if (!chart) return;
    const onOver = ({ dataIndex, event }: ECElementEvent) => {
      if (!event) return;
      const bounds = chart.getDom().getBoundingClientRect();
      // dataIndex 0 is the tree's root; tiles follow in data order.
      setHover({
        index: dataIndex - 1,
        x: bounds.left + event.offsetX,
        y: bounds.top + event.offsetY,
      });
    };
    chart.on("mouseover", onOver);
    chart.on("globalout", clearHover);
    return () => {
      chart.off("mouseover", onOver);
      chart.off("globalout", clearHover);
    };
  }, [chart, clearHover]);

  if (!model || tiles.length === 0)
    return (
      <PanelEmptyState
        icon={LayoutGrid}
        data={data}
        unusable="No row has a name and a positive value."
      />
    );
  const { groups, dropped } = model;

  // Legend swatches come from a surviving tile per group. A group whose only
  // tiles were folded into "Other" by maxTiles has no tile left to color, so
  // drop it from the legend rather than render a colorless swatch.
  const legendGroups = groups
    .map((group) => ({
      group,
      color: tiles.find((t) => t.group === group)?.color,
    }))
    .filter((g): g is { group: string; color: string } => g.color !== undefined);
  const hovered = hover ? tiles[hover.index] : undefined;

  return (
    <div className="flex h-full flex-col border-t border-border">
      <div
        className="relative min-h-0 flex-1 overflow-hidden text-muted-foreground"
        onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
      >
        {/* The canvas has no text of its own: say what it shows. */}
        <p className="sr-only">
          {chartLabel(
            "Treemap",
            tiles.map(({ name }) => name),
          )}
        </p>
        <div ref={chartElementRef} aria-hidden className="h-full w-full" />

        {/* rows the result contained but the treemap could not place */}
        {dropped > 0 && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {dropped} row{dropped === 1 ? "" : "s"} not shown
          </div>
        )}

        {/* group color legend — overlay like the GeoMap legend */}
        {spec.showLegend && legendGroups.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/70 px-2 py-1.5 text-xs backdrop-blur-sm">
            {legendGroups.map(({ group, color }) => (
              <div key={group} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                <span className="text-foreground">{group}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {hover && hovered && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={hovered.group}
            rows={[
              {
                key: hovered.name,
                color: hovered.color,
                label: hovered.name,
                value: formatter.format(hovered.value),
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
