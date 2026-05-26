import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Separator } from "@everr/ui/components/separator";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Hash, LineChart, Table } from "lucide-react";
import type { Panel, PluginSpecValue } from "@/data/dashboards/schema";
import { getVisualizationSettings } from "./visualizations";

interface VizOptionsProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

const CHART_TYPES = [
  { kind: "TimeSeriesChart", label: "Time Series", icon: LineChart },
  { kind: "StatChart", label: "Stat", icon: Hash },
  { kind: "Table", label: "Table", icon: Table },
] as const;

export function VizOptions({ draft, onChange }: VizOptionsProps) {
  const pluginKind = draft.spec.plugin.kind;
  const Settings = getVisualizationSettings(pluginKind);

  const handleKindChange = (next: string[]) => {
    const selected = next[0];
    if (!selected) return;
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: { ...draft.spec.plugin, kind: selected },
      },
    });
  };

  const handleDisplayName = (name: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        display: { ...draft.spec.display, name },
      },
    });
  };

  const handleDescription = (description: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        display: { ...draft.spec.display, description },
      },
    });
  };

  const handlePluginSpec = (spec: Record<string, unknown>) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: {
          ...draft.spec.plugin,
          spec: spec as Record<string, PluginSpecValue>,
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>Chart Type</Label>
        <ToggleGroup
          value={[pluginKind]}
          onValueChange={handleKindChange}
          variant="outline"
          size="sm"
        >
          {CHART_TYPES.map(({ kind, label, icon: Icon }) => (
            <ToggleGroupItem key={kind} value={kind} aria-label={label}>
              <Icon className="size-3.5" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="panel-title">Title</Label>
        <Input
          id="panel-title"
          value={draft.spec.display.name ?? ""}
          onChange={(e) => handleDisplayName(e.target.value)}
          placeholder="Panel title"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="panel-description">Description</Label>
        <Textarea
          id="panel-description"
          value={draft.spec.display.description ?? ""}
          onChange={(e) => handleDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      {Settings && (
        <>
          <Separator />
          <Settings
            spec={draft.spec.plugin.spec as Record<string, unknown>}
            onChange={handlePluginSpec}
          />
        </>
      )}
    </div>
  );
}
