import type { ChartTheme } from "@everr/ui/hooks/use-echart";
import { createTextMeasurer, TIME_AXIS_HEIGHT } from "../echarts/axis";
import type { PlotRect } from "../echarts/plot-rect";

/** The least room between two labels. */
const LABEL_GAP = 8;
/** Labels wider than this truncate rather than thin the axis further. */
const MAX_LABEL_WIDTH = 120;

/**
 * Column labels under a chart of rows, out of the rows' scroll like
 * `TimeAxis`. Each label sits under the middle of its column, shifted in
 * at the plot's edges so none is clipped; when they don't all fit, every nth
 * one shows, the same n throughout so the spacing stays even.
 */
export function CategoryAxis({
  theme,
  labels,
  plot,
}: {
  theme: ChartTheme;
  labels: string[];
  plot: PlotRect;
}) {
  const measure = createTextMeasurer(theme.fontFamily);
  const columnWidth = plot.width / labels.length;
  // A collapsed plot has no room for any label.
  if (!(columnWidth > 0)) return <div className="shrink-0" style={{ height: TIME_AXIS_HEIGHT }} />;
  const widest = Math.min(MAX_LABEL_WIDTH, Math.max(0, ...labels.map(measure)));
  const every = Math.max(1, Math.ceil((widest + LABEL_GAP) / columnWidth));
  const room = every * columnWidth - LABEL_GAP;
  return (
    <div className="relative shrink-0 overflow-hidden text-xs" style={{ height: TIME_AXIS_HEIGHT }}>
      {labels.map((label, index) => {
        if (index % every !== 0) return null;
        // The browser sizes the label: the canvas measure runs narrower than
        // the rendered text, so it only decides which edge a label hugs.
        const half = Math.min(measure(label), room) / 2;
        const center = plot.left + (index + 0.5) * columnWidth;
        const right = plot.left + plot.width;
        const place =
          center + half > right
            ? { left: right, transform: "translateX(-100%)" }
            : center - half < 0
              ? { left: 0 }
              : { left: center, transform: "translateX(-50%)" };
        return (
          <span
            key={label}
            className="absolute top-1 truncate whitespace-nowrap"
            style={{ ...place, maxWidth: room }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
