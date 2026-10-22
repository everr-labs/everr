import { ChartGantt } from "lucide-react";
import { useMemo } from "react";
import type { VisualizationProps } from "../index";
import { LaneTimelineChart } from "../lane-timeline-chart";
import type { StateTimelineSpec } from "./spec";
import { buildStateTimelineModel } from "./state-timeline-data";

export function StateTimelineVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<StateTimelineSpec>) {
  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const model = useMemo(
    () => (data ? buildStateTimelineModel(data, spec, domain) : null),
    [data, spec, domain],
  );

  // Each segment spans its sample until the lane's next one, so its tooltip
  // reads as a time range.
  const lanes = useMemo(
    () =>
      (model?.lanes ?? []).map((lane) => ({
        label: lane.label,
        items: lane.segments.map((s) => ({
          key: s.start,
          start: s.start,
          end: s.end,
          state: s.state,
          title: `${new Date(s.start).toLocaleString()} – ${new Date(s.end).toLocaleString()}`,
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
      onTimeRangeChange={onTimeRangeChange}
      emptyIcon={<ChartGantt className="size-8" />}
      emptyMessage={data ? "No state data in this time range" : "Configure a query to see results"}
    />
  );
}
