import { type ReactNode, useMemo } from "react";
import type { LayoutItem } from "react-grid-layout";
import { GridLayout, noCompactor, useContainerWidth } from "react-grid-layout";
import { persesToRGL } from "@/data/dashboards/convert";
import { GRID_COLS } from "@/data/dashboards/schema";
import { DashboardPanel } from "./dashboard-panel";
import { useDashboard } from "./use-dashboard";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

const ROW_HEIGHT = 30;

/**
 * `actions` share one bordered toolbar with the variable pickers instead of
 * getting a row of their own. Two controls separated by whitespace read as
 * unowned chrome floating above the grid; one strip with a divider is a single
 * object that belongs to the grid beneath it, and it keeps its shape on the
 * many dashboards that declare no variables at all.
 */
export function DashboardGrid({
  actions,
  leading,
}: {
  actions?: ReactNode;
  leading?: ReactNode;
} = {}) {
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
      {(hasVariables || actions || leading) && (
        <div className="mb-3 flex items-start gap-x-3">
          {leading}
          {leading && hasVariables && (
            <div aria-hidden className="mt-1.5 h-5 w-px bg-border" />
          )}
          {/*
            The variables wrap inside their own clipped column: each field
            draws a left hairline, and the bar's negative margin pulls every
            wrapped row's first hairline outside this wrapper, so no row ever
            starts or ends with a dangling divider.
          */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <VariableBar className="mb-0" layout="inline" />
          </div>
          {actions && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
      <div ref={containerRef}>
        <GridLayout
          width={width}
          className="layout"
          layout={layout}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: ROW_HEIGHT,
            // `containerPadding` defaults to `margin`, which insets the whole
            // grid by 10px and leaves the panels narrower than everything
            // stacked above them — the toolbar, the breadcrumb, the page. Zero
            // it so the panel block starts and ends on the page's own column;
            // `margin` still spaces the panels from each other.
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
