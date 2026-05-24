import { Button } from "@everr/ui/components/button";
import { GripVertical, X } from "lucide-react";
import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";

interface DashboardPanelProps {
  panel: Panel;
  panelKey: string;
  isEditing: boolean;
  onRemove?: () => void;
}

export function DashboardPanel({
  panel,
  panelKey,
  isEditing,
  onRemove,
}: DashboardPanelProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
      action={
        isEditing ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="drag-handle cursor-grab active:cursor-grabbing"
              aria-label="Drag to move"
            >
              <GripVertical />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRemove}
              aria-label="Remove panel"
            >
              <X />
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    </PanelShell>
  );
}
