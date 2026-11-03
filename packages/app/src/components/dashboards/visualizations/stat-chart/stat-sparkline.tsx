import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { StatTile } from "./stat-series";

echarts.use([LineChart, GridComponent, CanvasRenderer]);

export function StatSparkline({ points, color }: { points: StatTile["points"]; color: string }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption({
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
  }, [points, color]);

  return <div ref={elementRef} className="h-full w-full" aria-hidden="true" />;
}
