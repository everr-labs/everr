import { LineChart } from "echarts/charts";
import * as echarts from "echarts/core";
import { useEffect, useRef } from "react";
import { useEChart } from "../echarts/use-echart";
import type { StatTile } from "./stat-series";

echarts.use([LineChart]);

export function StatSparkline({ points, color }: { points: StatTile["points"]; color: string }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chart = useEChart(elementRef, true)?.chart;

  useEffect(() => {
    chart?.setOption({
      animation: false,
      grid: { top: 2, right: 0, bottom: 0, left: 0 },
      xAxis: { type: "value", min: "dataMin", max: "dataMax", show: false },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "line",
          data: points.map(({ ts, value }) => [ts, value]),
          showSymbol: false,
          silent: true,
          smooth: true,
          smoothMonotone: "x",
          lineStyle: { color, width: 1.5 },
          areaStyle: { color, opacity: 0.2 },
        },
      ],
    });
  }, [chart, points, color]);

  return <div ref={elementRef} className="h-full w-full" aria-hidden="true" />;
}
