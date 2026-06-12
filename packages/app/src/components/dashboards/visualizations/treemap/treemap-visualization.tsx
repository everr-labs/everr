import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import type { VisualizationProps } from "../index";
import { SeriesTooltipContent } from "../series-tooltip";
import { formatStatValue } from "../stat-chart/stat-calculations";
import type { TreemapSpec } from "./spec";
import { TreemapChart } from "./treemap-chart";
import { buildTreemapTiles } from "./treemap-data";

function formatValue(value: number, unit: string): string {
  return `${formatStatValue(value, undefined)}${unit ? ` ${unit}` : ""}`;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <LayoutGrid className="size-8" />
      <p className="text-sm">No data to tile in this result</p>
    </div>
  );
}

export function TreemapVisualization({
  spec,
  data,
}: VisualizationProps<TreemapSpec>) {
  const model = useMemo(
    () => (data ? buildTreemapTiles(data, spec) : null),
    [data, spec],
  );
  const chartData = useMemo(
    () => model?.tiles.map((t) => ({ ...t, fill: t.color })) ?? [],
    [model],
  );

  if (!model || model.tiles.length === 0) return <EmptyState />;
  const { tiles, groups, dropped } = model;

  // Legend swatches come from a surviving tile per group. A group whose only
  // tiles were folded into "Other" by maxTiles has no tile left to color, so
  // drop it from the legend rather than render a colorless swatch.
  const legendGroups = groups
    .map((group) => ({
      group,
      color: tiles.find((t) => t.group === group)?.color,
    }))
    .filter((g): g is { group: string; color: string } => g.color !== undefined);

  return (
    <div className="flex h-full flex-col border-t border-border">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TreemapChart
          data={chartData}
          tileValueText={
            spec.showValues ? (t) => formatValue(t.value, spec.unit) : undefined
          }
          renderTooltip={(t) => (
            <SeriesTooltipContent
              title={t.group}
              rows={[
                {
                  key: t.name,
                  color: t.fill,
                  label: t.name,
                  value: formatValue(t.value, spec.unit),
                },
              ]}
            />
          )}
        />

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
                  style={{ backgroundColor: color, opacity: 0.85 }}
                />
                <span className="text-foreground">{group}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
