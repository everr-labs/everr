import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Pencil, Plus, Save } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import {
  GridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import {
  panelRefFromKey,
  persesToRGL,
  rglToPerses,
} from "@/data/dashboards/convert";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import { useSaveDashboard } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/schema";
import { DashboardPanel } from "./dashboard-panel";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

function generatePanelKey(panels: Record<string, Panel>): string {
  let i = 1;
  while (`panel${i}` in panels) i++;
  return `panel${i}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `dashboard-${Date.now()}`
  );
}

interface DashboardGridProps {
  isNew?: boolean;
}

export function DashboardGrid({ isNew }: DashboardGridProps) {
  const navigate = useNavigate();
  const dashboard = useDashboardStore((s) => s.dashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  const saveMutation = useSaveDashboard();

  const [isEditing, setIsEditing] = useState(isNew ?? false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
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
    if (!dashboard) return;
    if (isNew) {
      setSaveName(dashboard.spec.display?.name ?? "");
      setShowSaveDialog(true);
      return;
    }
    saveMutation.mutate({
      slug: dashboard.metadata.name,
      spec: dashboard.spec,
    });
  }, [dashboard, saveMutation, isNew]);

  const handleConfirmSave = useCallback(() => {
    if (!dashboard || !saveName.trim()) return;
    const slug = slugify(saveName);
    const spec = {
      ...dashboard.spec,
      display: { ...dashboard.spec.display, name: saveName.trim() },
    };
    saveMutation.mutate(
      { slug, spec },
      {
        onSuccess: (data) => {
          setShowSaveDialog(false);
          navigate({
            to: "/dashboards/$dashboardId",
            params: { dashboardId: data.slug },
          });
        },
      },
    );
  }, [dashboard, saveName, saveMutation, navigate]);

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
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending}
              >
                <Save data-icon="inline-start" />
                {saveMutation.isPending ? "Saving…" : "Save"}
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

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Dashboard</DialogTitle>
            <DialogDescription>
              Give your dashboard a name to save it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dashboard-name">Name</Label>
            <Input
              id="dashboard-name"
              ref={nameInputRef}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmSave();
              }}
              placeholder="My Dashboard"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSave}
              disabled={!saveName.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
