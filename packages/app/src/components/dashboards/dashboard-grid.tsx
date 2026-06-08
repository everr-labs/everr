import { useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import {
  GridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import { persesToRGL } from "@/data/dashboards/convert";
import { DashboardPanel } from "./dashboard-panel";
import { useDashboard } from "./use-dashboard";
import { VariableBar } from "./variable-bar";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

export function DashboardGrid() {
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
      <VariableBar />
      <div ref={containerRef}>
        <GridLayout
          width={width}
          className="layout"
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{ enabled: false, handle: ".drag-handle", bounded: true }}
          resizeConfig={{ enabled: false, handles: ["se"] }}
          compactor={verticalCompactor}
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
