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
import type { Dashboard, Panel } from "@/data/dashboards/types";
import { DashboardPanel } from "./dashboard-panel";

import "react-grid-layout/css/styles.css";
import "./dashboard-grid.css";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

interface DashboardGridProps {
  dashboard: Dashboard;
}

function generatePanelKey(panels: Record<string, Panel>): string {
  let i = 1;
  while (`panel${i}` in panels) i++;
  return `panel${i}`;
}

export function DashboardGrid({ dashboard: initial }: DashboardGridProps) {
  const [dashboard, setDashboard] = useState(initial);
  const [isEditing, setIsEditing] = useState(false);
  const { width, containerRef } = useContainerWidth({
    measureBeforeMount: true,
  });

  const layout = useMemo(() => {
    const firstLayout = dashboard.spec.layouts[0];
    if (!firstLayout) return [];
    return persesToRGL(firstLayout.spec.items);
  }, [dashboard]);

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    setDashboard((prev) => ({
      ...prev,
      spec: {
        ...prev.spec,
        layouts: [
          {
            kind: "Grid" as const,
            spec: {
              ...prev.spec.layouts[0]?.spec,
              items: rglToPerses([...newLayout]),
            },
          },
          ...prev.spec.layouts.slice(1),
        ],
      },
    }));
  }, []);

  const handleAddPanel = useCallback(() => {
    setDashboard((prev) => {
      const key = generatePanelKey(prev.spec.panels);
      const newPanel: Panel = {
        kind: "Panel",
        spec: {
          display: { name: "New Panel" },
          plugin: { kind: "TimeSeriesChart", spec: {} },
        },
      };

      const maxY =
        prev.spec.layouts[0]?.spec.items.reduce(
          (max, item) => Math.max(max, item.y + item.height),
          0,
        ) ?? 0;

      const newItem = {
        x: 0,
        y: maxY,
        width: 12,
        height: 8,
        content: { $ref: panelRefFromKey(key) },
      };

      return {
        ...prev,
        spec: {
          ...prev.spec,
          panels: { ...prev.spec.panels, [key]: newPanel },
          layouts: [
            {
              kind: "Grid" as const,
              spec: {
                ...prev.spec.layouts[0]?.spec,
                items: [...(prev.spec.layouts[0]?.spec.items ?? []), newItem],
              },
            },
            ...prev.spec.layouts.slice(1),
          ],
        },
      };
    });
  }, []);

  const handleRemovePanel = useCallback((panelKey: string) => {
    setDashboard((prev) => {
      const { [panelKey]: _, ...remainingPanels } = prev.spec.panels;
      return {
        ...prev,
        spec: {
          ...prev.spec,
          panels: remainingPanels,
          layouts: [
            {
              kind: "Grid" as const,
              spec: {
                ...prev.spec.layouts[0]?.spec,
                items: (prev.spec.layouts[0]?.spec.items ?? []).filter(
                  (item) => item.content.$ref !== panelRefFromKey(panelKey),
                ),
              },
            },
            ...prev.spec.layouts.slice(1),
          ],
        },
      };
    });
  }, []);

  const handleSave = useCallback(() => {
    toast.info("Dashboard saved (mock — no persistence yet)");
  }, []);

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
          className="layout"
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
          dragConfig={{ enabled: isEditing, handle: ".drag-handle" }}
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
