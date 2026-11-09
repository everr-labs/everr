import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import type { VisualizationProps } from "../index";
import { LaneTimelineChart } from "../lane-timeline-chart";
import type { StatusHistorySpec } from "./spec";
import { buildStatusHistoryModel } from "./status-history-data";
import { PanelEmptyState } from "../panel-empty-state";

export function StatusHistoryVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<StatusHistorySpec>) {
  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const model = useMemo(
    () => (data ? buildStatusHistoryModel(data, spec, domain) : null),
    [data, spec, domain],
  );

  // Each cell is an independent sample, so its tooltip shows the single instant.
  const lanes = useMemo(
    () =>
      (model?.lanes ?? []).map((lane) => ({
        label: lane.label,
        items: lane.cells.map((c) => ({
          start: c.start,
          end: c.end,
          state: c.state,
          title: new Date(c.ts).toLocaleString(),
        })),
      })),
    [model],
  );

  return (
    <LaneTimelineChart
      lanes={lanes}
      states={model?.states ?? []}
      colorByState={model?.colorByState ?? {}}
      domain={domain}
      rowHeight={spec.rowHeight}
      showValues={spec.showValues}
      showLegend={spec.showLegend}
      rounded
      onTimeRangeChange={onTimeRangeChange}
      empty={
        <PanelEmptyState
          icon={LayoutGrid}
          data={data}
          unusable="No row has a time and a status inside this time range."
        />
      }
    />
  );
}
