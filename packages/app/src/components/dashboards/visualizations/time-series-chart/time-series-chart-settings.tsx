import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { VisualizationSettingsProps } from "../index";

const CURVE_TYPES = [
  { value: "monotone", label: "Smooth" },
  { value: "linear", label: "Linear" },
  { value: "natural", label: "Natural" },
  { value: "stepBefore", label: "Step before" },
  { value: "stepAfter", label: "Step after" },
] as const;

export type CurveType = (typeof CURVE_TYPES)[number]["value"];

export function TimeSeriesChartSettings({
  spec,
  onChange,
}: VisualizationSettingsProps) {
  const showLegend = spec.showLegend === true;
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const curveType =
    typeof spec.curveType === "string" ? spec.curveType : "monotone";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Line style</Label>
        <ToggleGroup
          value={[curveType]}
          onValueChange={(next) => {
            if (next[0]) onChange({ ...spec, curveType: next[0] });
          }}
          variant="outline"
          size="sm"
        >
          {CURVE_TYPES.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ts-unit">Unit</Label>
        <Input
          id="ts-unit"
          value={unit}
          onChange={(e) => onChange({ ...spec, unit: e.target.value })}
          placeholder="e.g. req/s, ms, %"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="ts-legend">Show legend</Label>
        <Switch
          id="ts-legend"
          size="sm"
          checked={showLegend}
          onCheckedChange={(checked) =>
            onChange({ ...spec, showLegend: checked })
          }
        />
      </div>
    </div>
  );
}
