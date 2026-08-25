import { type ReactNode, useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, noCompactor, useContainerWidth } from "react-grid-layout";
import { FrameToggle } from "@/components/rail/frame-toggle";
import { persesToRGL } from "@/data/dashboards/convert";
import { GRID_COLS } from "@/data/dashboards/schema";
import { DashboardPanel } from "./dashboard-panel";
import { useDashboard } from "./use-dashboard";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

const ROW_HEIGHT = 30;

export function DashboardGrid({
  actions,
  notice,
}: {
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  const dashboard = useDashboard();
  const hasVariables = useHasVisibleVariables();
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
      <div className="mb-3 flex items-start gap-x-3">
        <div className="flex h-8 shrink-0 items-center">
          <FrameToggle />
        </div>
        {hasVariables && (
          <div aria-hidden className="flex h-8 items-center">
            <div className="h-5 w-px bg-border" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <VariableBar layout="inline" />
        </div>
        {actions && (
          <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
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
                <DashboardPanel panel={panel} panelKey={item.i} />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
