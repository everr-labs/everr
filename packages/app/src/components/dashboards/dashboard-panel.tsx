import { Button } from "@everr/ui/components/button";
import { X } from "lucide-react";
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
      headerClassName={
        isEditing ? "drag-handle cursor-grab active:cursor-grabbing" : undefined
      }
      action={
        isEditing ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRemove}
            aria-label="Remove panel"
          >
            <X />
          </Button>
        ) : undefined
      }
    >
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    </PanelShell>
  );
}
