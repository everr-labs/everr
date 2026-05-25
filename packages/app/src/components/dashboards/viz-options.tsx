import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Hash, LineChart, Table } from "lucide-react";
import type { Panel } from "@/data/dashboards/types";

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

  const handleUnit = (unit: string) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: {
          ...draft.spec.plugin,
          spec: { ...draft.spec.plugin.spec, unit },
        },
      },
    });
  };

  const handleShowLegend = (next: string[]) => {
    onChange({
      ...draft,
      spec: {
        ...draft.spec,
        plugin: {
          ...draft.spec.plugin,
          spec: {
            ...draft.spec.plugin.spec,
            showLegend: next.includes("showLegend"),
          },
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

      <div className="grid gap-4 sm:grid-cols-2">
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
          <Label htmlFor="panel-unit">Unit</Label>
          <Input
            id="panel-unit"
            value={
              typeof draft.spec.plugin.spec.unit === "string"
                ? draft.spec.plugin.spec.unit
                : ""
            }
            onChange={(e) => handleUnit(e.target.value)}
            placeholder="e.g. req/s, ms, %"
          />
        </div>
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

      {pluginKind === "TimeSeriesChart" && (
        <div className="flex flex-col gap-2">
          <Label>Legend</Label>
          <ToggleGroup
            value={draft.spec.plugin.spec.showLegend ? ["showLegend"] : []}
            onValueChange={handleShowLegend}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="showLegend" aria-label="Show legend">
              Show legend
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
