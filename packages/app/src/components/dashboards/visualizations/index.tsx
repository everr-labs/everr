import type { ComponentType } from "react";
import type { PanelPlugin } from "@/data/dashboards/types";
import { TableSettings } from "./table/table-settings";
import { TableVisualization } from "./table/table-visualization";

export interface VisualizationProps {
  plugin: PanelPlugin;
}

export interface VisualizationSettingsProps {
  spec: Record<string, unknown>;
  onChange: (spec: Record<string, unknown>) => void;
}

interface VisualizationEntry {
  component: ComponentType<VisualizationProps>;
  settings?: ComponentType<VisualizationSettingsProps>;
  inset?: "default" | "flush-content";
}

const registry: Record<string, VisualizationEntry> = {
  Table: {
    component: TableVisualization,
    settings: TableSettings,
    inset: "flush-content",
  },
};

export function getVisualizationInset(
  kind: string,
): "default" | "flush-content" {
  return registry[kind]?.inset ?? "default";
}

export function getVisualizationSettings(
  kind: string,
): ComponentType<VisualizationSettingsProps> | undefined {
  return registry[kind]?.settings;
}

export function PanelVisualization({ plugin }: VisualizationProps) {
  const entry = registry[plugin.kind];

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{plugin.kind}</p>
      </div>
    );
  }

  const Component = entry.component;
  return <Component plugin={plugin} />;
}
