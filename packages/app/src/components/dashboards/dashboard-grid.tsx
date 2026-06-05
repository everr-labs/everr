import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  EllipsisVertical,
  FolderInput,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  dashboardListOptions,
  folderListOptions,
  useCreateDashboard,
  useDeleteDashboard,
  useMoveDashboard,
  useRenameDashboard,
  useSaveDashboard,
} from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/schema";
import { DashboardPanel } from "./dashboard-panel";
import { DeleteDashboardDialog } from "./delete-dashboard-dialog";
import { FolderList, FolderPickerDialog } from "./folder-picker";
import { NameDialog } from "./name-dialog";

const GRID_COLS = 24;
const ROW_HEIGHT = 30;

function generatePanelKey(panels: Record<string, Panel>): string {
  let i = 1;
  while (`panel${i}` in panels) i++;
  return `panel${i}`;
}

interface DashboardGridProps {
  isNew?: boolean;
  defaultFolderId?: string | null;
}

export function DashboardGrid({ isNew, defaultFolderId }: DashboardGridProps) {
  const navigate = useNavigate();
  const dashboard = useDashboardStore((s) => s.dashboard);
  const updatePanel = useDashboardStore((s) => s.updatePanel);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const setDashboard = useDashboardStore((s) => s.setDashboard);

  const saveMutation = useSaveDashboard();
  const createMutation = useCreateDashboard();

  const isEditing = useDashboardStore((s) => s.isEditing);
  const setEditing = useDashboardStore((s) => s.setEditing);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveFolderId, setSaveFolderId] = useState<string | null>(
    defaultFolderId ?? null,
  );
  const [manageAction, setManageAction] = useState<
    "rename" | "move" | "delete" | null
  >(null);

  const router = useRouter();
  const renameMutation = useRenameDashboard();
  const moveMutation = useMoveDashboard();
  const deleteMutation = useDeleteDashboard();

  const { data: folders } = useQuery(folderListOptions());
  const { data: dashboardList } = useQuery(dashboardListOptions());
  const currentFolderId =
    dashboardList?.find((d) => d.slug === dashboard?.metadata.name)?.folderId ??
    null;

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

  const handleDuplicatePanel = useCallback(
    (panelKey: string) => {
      if (!dashboard) return;
      const source = dashboard.spec.panels[panelKey];
      if (!source) return;
      const newKey = generatePanelKey(dashboard.spec.panels);
      const sourceItem = dashboard.spec.layouts[0]?.spec.items.find(
        (item) => item.content.$ref === panelRefFromKey(panelKey),
      );

      const insertY = (sourceItem?.y ?? 0) + (sourceItem?.height ?? 8);
      const newHeight = sourceItem?.height ?? 8;
      const existingItems = (dashboard.spec.layouts[0]?.spec.items ?? []).map(
        (item) =>
          item.y >= insertY ? { ...item, y: item.y + newHeight } : item,
      );

      updatePanel(newKey, structuredClone(source));
      updateLayout([
        {
          kind: "Grid" as const,
          spec: {
            ...dashboard.spec.layouts[0]?.spec,
            items: [
              ...existingItems,
              {
                x: sourceItem?.x ?? 0,
                y: insertY,
                width: sourceItem?.width ?? 12,
                height: newHeight,
                content: { $ref: panelRefFromKey(newKey) },
              },
            ],
          },
        },
        ...dashboard.spec.layouts.slice(1),
      ]);
    },
    [dashboard, updatePanel, updateLayout],
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
    const spec = {
      ...dashboard.spec,
      display: { ...dashboard.spec.display, name: saveName.trim() },
    };
    createMutation.mutate(
      { spec, folderId: saveFolderId ?? undefined },
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
  }, [dashboard, saveName, saveFolderId, createMutation, navigate]);

  if (!dashboard) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
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
          onClick={() => setEditing(!isEditing)}
        >
          <Pencil data-icon="inline-start" />
          {isEditing ? "Done" : "Edit"}
        </Button>
        {!isNew && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" />}
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setManageAction("rename")}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setManageAction("move")}>
                <FolderInput />
                Move to folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setManageAction("delete")}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div ref={containerRef}>
        <GridLayout
          width={width}
          className={isEditing && mounted ? "layout layout-editing" : "layout"}
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
                  onDuplicate={() => handleDuplicatePanel(item.i)}
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
          <div className="flex flex-col gap-2">
            <Label>Folder</Label>
            <FolderList
              folders={folders ?? []}
              value={saveFolderId}
              onChange={setSaveFolderId}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSave}
              disabled={!saveName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NameDialog
        open={manageAction === "rename"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        title="Rename dashboard"
        initialName={dashboard.spec.display?.name ?? ""}
        confirmLabel="Rename"
        isPending={renameMutation.isPending}
        onConfirm={(name) => {
          renameMutation.mutate(
            { slug: dashboard.metadata.name, name },
            {
              onSuccess: () => {
                setDashboard({
                  ...dashboard,
                  spec: {
                    ...dashboard.spec,
                    display: { ...dashboard.spec.display, name },
                  },
                });
                void router.invalidate();
                setManageAction(null);
              },
            },
          );
        }}
      />

      <FolderPickerDialog
        open={manageAction === "move"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        title="Move dashboard"
        folders={folders ?? []}
        initialFolderId={currentFolderId}
        isPending={moveMutation.isPending}
        onConfirm={(folderId) => {
          moveMutation.mutate(
            { slug: dashboard.metadata.name, folderId },
            { onSuccess: () => setManageAction(null) },
          );
        }}
      />

      <DeleteDashboardDialog
        open={manageAction === "delete"}
        onOpenChange={(open) => {
          if (!open) setManageAction(null);
        }}
        name={dashboard.spec.display?.name ?? dashboard.metadata.name}
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          deleteMutation.mutate(dashboard.metadata.name, {
            onSuccess: () => {
              setManageAction(null);
              navigate({ to: "/dashboards" });
            },
          });
        }}
      />
    </div>
  );
}
