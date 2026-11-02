import { type ReactNode, useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, noCompactor, useContainerWidth } from "react-grid-layout";
import { persesToRGL } from "#app/data/dashboards/convert.ts";
import { GRID_COLS } from "#app/data/dashboards/schema.ts";
import { DashboardPanel, type PanelFullscreenTo } from "./dashboard-panel";
import { DashboardToolbar } from "./dashboard-toolbar";
import { useDashboard } from "./use-dashboard";

const ROW_HEIGHT = 30;

export function DashboardGrid({
  actions,
  notice,
  frameToggle = true,
  panelFullscreenTo,
}: {
  actions?: ReactNode;
  notice?: ReactNode;
  /** Off where the grid is not seated next to a rail (the home page). */
  frameToggle?: boolean;
  /**
   * The dashboard whose panel pages the grid's maximize links open: the
   * dashboard pages pass their own address, Home passes its built-in. Runbook
   * embeds render `DashboardPanel` without a grid, so they show no maximize
   * affordance.
   */
  panelFullscreenTo: PanelFullscreenTo;
}) {
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
      <DashboardToolbar actions={actions} frameToggle={frameToggle} />
      {notice && <div className="mb-3">{notice}</div>}
      <div ref={containerRef}>
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
                <DashboardPanel panel={panel} panelKey={item.i} fullscreenTo={panelFullscreenTo} />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
