import { useMemo } from "react";
import { CursorTooltip } from "@/components/cursor-tooltip";
import { SeriesTooltipContent } from "@/components/dashboards/visualizations/series-tooltip";
import { formatElapsed } from "@/data/alerting/triage/format";
import type { AlertSparkData } from "@/data/alerting/triage/view";
import {
  ChartCrosshair,
  instanceRowsAt,
  tooltipTime,
  useChartScrub,
} from "./chart-crosshair";

const WIDTH = 80;
const HEIGHT = 26;
/** Room for the line's own stroke at either extreme. */
const PAD = 2;

/**
 * The worst instance's value over the selected window, as the triage row's
 * sparkline.
 *
 * The line is the envelope rather than one series: the row is about the rule,
 * and the rule is as bad as its worst instance. The hover is the one this
 * screen uses everywhere else, so the number the line drew is never the only
 * thing a reader can get out of it.
 */
export function AlertSparkline({
  spark,
  tone,
  name,
}: {
  spark: AlertSparkData;
  tone: string;
  /** For the accessible description; the visible label is the row's own. */
  name: string;
}) {
  const scrub = useChartScrub(spark.windowMinutes);
  const { hovered } = scrub;

  // None of the geometry depends on the pointer, and the pointer moves at
  // frame rate: rebuilding the envelope and both paths on every mousemove
  // would be the whole chart's work per event.
  const shape = useMemo(() => {
    // One point per bucket, worst instance wins. Buckets nobody evaluated are
    // absent rather than zero: a gap is not a reading of zero.
    const points = new Map<number, number>();
    for (const instance of spark.instances) {
      for (const point of instance.points) {
        if (point.at > spark.windowMinutes) continue;
        points.set(
          point.at,
          Math.max(points.get(point.at) ?? -Infinity, point.high),
        );
      }
    }
    const series = [...points.entries()]
      .map(([at, value]) => ({ at, value }))
      .sort((a, b) => b.at - a.at);
    if (series.length < 2) return null;

    const values = series.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const x = (at: number) =>
      ((spark.windowMinutes - at) / spark.windowMinutes) * WIDTH;
    const y = (value: number) =>
      max === min
        ? HEIGHT / 2
        : HEIGHT - PAD - ((value - min) / (max - min)) * (HEIGHT - PAD * 2);

    const line = series
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`,
      )
      .join(" ");
    const area = `${line} L${x(series[series.length - 1].at).toFixed(1)} ${HEIGHT} L${x(series[0].at).toFixed(1)} ${HEIGHT} Z`;
    return { line, area, min, max };
  }, [spark]);

  if (!shape) return <div style={{ width: WIDTH, height: HEIGHT }} />;

  return (
    <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${name}: worst instance between ${shape.min} and ${shape.max} over the last ${formatElapsed(spark.windowMinutes * 60_000)}`}
        onMouseMove={scrub.onMouseMove}
        onMouseLeave={scrub.onMouseLeave}
      >
        <path d={shape.area} fill={tone} opacity={0.15} />
        <path
          d={shape.line}
          fill="none"
          stroke={tone}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {hovered && (
        <>
          <ChartCrosshair left={scrub.left} />
          <CursorTooltip x={hovered.clientX} y={hovered.clientY}>
            <SeriesTooltipContent
              title={tooltipTime(spark.endsAt, hovered.at)}
              rows={instanceRowsAt(
                spark.instances,
                hovered.at,
                spark.windowMinutes,
              )}
            />
          </CursorTooltip>
        </>
      )}
    </div>
  );
}
