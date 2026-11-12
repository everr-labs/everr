import { type ReactNode, useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, noCompactor, useContainerWidth } from "react-grid-layout";
import { persesToRGL } from "#app/data/dashboards/convert.ts";
import { GRID_COLS } from "#app/data/dashboards/schema.ts";
import { DashboardPanel } from "./dashboard-panel";
import { DashboardToolbar } from "./dashboard-toolbar";
import {
  type DashboardAddress,
  MaximizePanelLink,
  useMovingPanel,
  useRestoredGridScroll,
} from "./panel-links";
import { useDashboard } from "./use-dashboard";
import { SharedTimeCursorProvider } from "./visualizations/shared-time-cursor";

const ROW_HEIGHT = 30;

export function DashboardGrid({
  address,
  actions,
  notice,
  frameToggle = true,
}: {
  /** Where this dashboard lives: each panel header links to its maximized page there. */
  address: DashboardAddress;
  actions?: ReactNode;
  notice?: ReactNode;
  /** Off where the grid is not seated next to a rail (the home page). */
  frameToggle?: boolean;
}) {
  const dashboard = useDashboard();
  const movingPanel = useMovingPanel();
  const { width, containerRef } = useContainerWidth({
    measureBeforeMount: true,
  });
  useRestoredGridScroll(containerRef);

  const layout = useMemo(() => {
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  return (
    <div>
      <DashboardToolbar actions={actions} frameToggle={frameToggle} />
      {notice && <div className="mb-3">{notice}</div>}
      <div ref={containerRef}>
        <SharedTimeCursorProvider key={`${dashboard.metadata.project}/${dashboard.metadata.name}`}>
          <GridLayout
            width={width}
            className="layout"
            layout={layout}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              containerPadding: [0, 0],
            }}
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
                  <DashboardPanel
                    panel={panel}
                    panelKey={item.i}
                    moving={item.i === movingPanel}
                    action={
                      <MaximizePanelLink
                        address={address}
                        panelKey={item.i}
                        title={panel.spec.display?.name ?? item.i}
                      />
                    }
                  />
                </div>
              );
            })}
          </GridLayout>
        </SharedTimeCursorProvider>
      </div>
    </div>
  );
}
