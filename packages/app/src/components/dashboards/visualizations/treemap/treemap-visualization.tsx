import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import { TreemapChart } from "@/components/treemap-chart";
import type { VisualizationProps } from "../index";
import { formatStatValue } from "../stat-chart/stat-calculations";
import type { TreemapSpec } from "./spec";
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

  return (
    <div className="flex h-full flex-col border-t border-border">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TreemapChart
          data={chartData}
          tileValueText={
            spec.showValues ? (t) => formatValue(t.value, spec.unit) : undefined
          }
          renderTooltip={(t) => (
            <>
              {t.group !== undefined && (
                <div className="mb-1 text-muted-foreground">{t.group}</div>
              )}
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: t.fill }}
                />
                <span className="text-muted-foreground">{t.name}</span>
                <span className="text-right font-medium tabular-nums">
                  {formatValue(t.value, spec.unit)}
                </span>
              </div>
            </>
          )}
        />

        {/* rows the result contained but the treemap could not place */}
        {dropped > 0 && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-background/70 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            {dropped} row{dropped === 1 ? "" : "s"} not shown
          </div>
        )}

        {/* group color legend — overlay like the GeoMap legend */}
        {spec.showLegend && groups.length > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/70 px-2 py-1.5 text-xs backdrop-blur-sm">
            {groups.map((group) => (
              <div key={group} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: tiles.find((t) => t.group === group)
                      ?.color,
                    opacity: 0.85,
                  }}
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
