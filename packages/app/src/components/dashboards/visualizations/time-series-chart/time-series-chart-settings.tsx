import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { VisualizationSettingsProps } from "../index";

export function TimeSeriesChartSettings({
  spec,
  onChange,
}: VisualizationSettingsProps) {
  const showLegend = spec.showLegend === true;
  const unit = typeof spec.unit === "string" ? spec.unit : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ts-unit">Unit</Label>
        <Input
          id="ts-unit"
          value={unit}
          onChange={(e) => onChange({ ...spec, unit: e.target.value })}
          placeholder="e.g. req/s, ms, %"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Legend</Label>
        <ToggleGroup
          value={showLegend ? ["showLegend"] : []}
          onValueChange={(next) =>
            onChange({ ...spec, showLegend: next.includes("showLegend") })
          }
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="showLegend" aria-label="Show legend">
            Show legend
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
