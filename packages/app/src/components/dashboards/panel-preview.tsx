import type { Panel } from "@/data/dashboards/types";
import { PanelShell } from "../panel-shell";

interface PanelPreviewProps {
  panel: Panel;
  panelKey: string;
}

export function PanelPreview({ panel, panelKey }: PanelPreviewProps) {
  const { display, plugin } = panel.spec;

  return (
    <PanelShell
      title={display.name ?? panelKey}
      description={display.description}
      status="success"
      className="h-full"
    >
      <div className="flex h-full min-h-32 items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    </PanelShell>
  );
}
