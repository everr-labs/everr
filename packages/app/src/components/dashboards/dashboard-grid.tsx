import { Button } from "@everr/ui/components/button";
import { LayoutDashboard, Pencil, Plus, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import {
  GridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import { toast } from "sonner";
import {
  panelRefFromKey,
  persesToRGL,
  rglToPerses,
} from "@/data/dashboards/convert";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Panel } from "@/data/dashboards/types";
import { DashboardPanel } from "./dashboard-panel";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

function generatePanelKey(panels: Record<string, Panel>): string {
  let i = 1;
  while (`panel${i}` in panels) i++;
  return `panel${i}`;
}

export function DashboardGrid() {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  const [isEditing, setIsEditing] = useState(false);
  const { width, containerRef } = useContainerWidth({
    measureBeforeMount: true,
  });

  const layout = useMemo(() => {
    if (!dashboard) return [];
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!dashboard) return;
      updateLayout([
        {
          kind: "Grid" as const,
          spec: {
            ...dashboard.spec.layouts[0]?.spec,
            items: rglToPerses([...newLayout]),
          },
        },
        ...dashboard.spec.layouts.slice(1),
      ]);
    },
    [dashboard, updateLayout],
  );

  const handleAddPanel = useCallback(() => {
    if (!dashboard) return;
    const key = generatePanelKey(dashboard.spec.panels);
    const newPanel: Panel = {
      kind: "Panel",
      spec: {
        display: { name: "New Panel" },
        plugin: { kind: "TimeSeriesChart", spec: {} },
      },
    };

    const maxY =
      dashboard.spec.layouts[0]?.spec.items.reduce(
        (max, item) => Math.max(max, item.y + item.height),
        0,
      ) ?? 0;

    updatePanel(key, newPanel);
    updateLayout([
      {
        kind: "Grid" as const,
        spec: {
          ...dashboard.spec.layouts[0]?.spec,
          items: [
            ...(dashboard.spec.layouts[0]?.spec.items ?? []),
            {
              x: 0,
              y: maxY,
              width: 12,
              height: 8,
              content: { $ref: panelRefFromKey(key) },
            },
          ],
        },
      },
      ...dashboard.spec.layouts.slice(1),
    ]);
  }, [dashboard, updatePanel, updateLayout]);

  const handleRemovePanel = useCallback(
    (panelKey: string) => {
      if (!dashboard) return;
      const { [panelKey]: _, ...remainingPanels } = dashboard.spec.panels;
      setDashboard({
        ...dashboard,
        spec: {
          ...dashboard.spec,
          panels: remainingPanels,
          layouts: [
            {
              kind: "Grid" as const,
              spec: {
                ...dashboard.spec.layouts[0]?.spec,
                items: (dashboard.spec.layouts[0]?.spec.items ?? []).filter(
                  (item) => item.content.$ref !== panelRefFromKey(panelKey),
                ),
              },
            },
            ...dashboard.spec.layouts.slice(1),
          ],
        },
      });
    },
    [dashboard, setDashboard],
  );

  const handleSave = useCallback(() => {
    toast.info("Dashboard saved (mock — no persistence yet)");
  }, []);

  if (!dashboard) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {dashboard.spec.display?.name ?? dashboard.metadata.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && (
            <>
              <Button variant="outline" size="sm" onClick={handleAddPanel}>
                <Plus data-icon="inline-start" />
                Add Panel
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Save data-icon="inline-start" />
                Save
              </Button>
            </>
          )}
          <Button
            variant={isEditing ? "default" : "outline"}
            size="sm"
            onClick={() => setIsEditing((v) => !v)}
          >
            <Pencil data-icon="inline-start" />
            {isEditing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      <div ref={containerRef}>
        <GridLayout
          width={width}
          className={isEditing ? "layout layout-editing" : "layout"}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{
            enabled: isEditing,
            handle: ".drag-handle",
            bounded: true,
          }}
          resizeConfig={{ enabled: isEditing, handles: ["se"] }}
          onLayoutChange={handleLayoutChange}
          compactor={verticalCompactor}
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
                  dashboardId={dashboard.metadata.name}
                  isEditing={isEditing}
                  onRemove={() => handleRemovePanel(item.i)}
                />
              </div>
            );
          })}
        </GridLayout>
      </div>
    </div>
  );
}
