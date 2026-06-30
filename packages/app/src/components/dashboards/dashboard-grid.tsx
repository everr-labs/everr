import { useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, noCompactor, useContainerWidth } from "react-grid-layout";
import { persesToRGL } from "@/data/dashboards/convert";
import { DashboardPanel } from "./dashboard-panel";
import { useDashboard } from "./use-dashboard";
import { VariableBar } from "./variable-bar";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

export function DashboardGrid({ preview = false }: { preview?: boolean }) {
  const dashboard = useDashboard();
  const { width, containerRef } = useContainerWidth({
    measureBeforeMount: true,
  });

  const layout = useMemo(() => {
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  return (
    <div>
      {!preview && <VariableBar />}
      <div ref={containerRef}>
        <GridLayout
          width={width}
          className="layout"
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
          // No compaction: render panels at their authored x/y so intentional
          // empty rows and spacing are preserved (this grid is read-only).
          compactor={noCompactor}
          autoSize
        >
          {layout.map((item: LayoutItem) => {
            const panel = dashboard.spec.panels[item.i];
            if (!panel) return null;
            return (
              <div key={item.i}>
                <DashboardPanel panel={panel} panelKey={item.i} />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
