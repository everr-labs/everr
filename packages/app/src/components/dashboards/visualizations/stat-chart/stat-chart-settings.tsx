import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { cn } from "@everr/ui/lib/utils";
import { Plus, X } from "lucide-react";
import type { VisualizationSettingsProps } from "../index";
import {
  CALCULATIONS,
  isCalculationType,
  type ThresholdStep,
  type ThresholdsSpec,
} from "./stat-calculations";

const THRESHOLD_COLORS = [
  { label: "Green", value: "#22c55e" },
  { label: "Yellow", value: "#eab308" },
  { label: "Orange", value: "#f97316" },
  { label: "Red", value: "#ef4444" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
] as const;

function getThresholds(spec: Record<string, unknown>): ThresholdsSpec {
  const t = spec.thresholds;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    return t as ThresholdsSpec;
  }
  return {};
}

export function StatChartSettings({
  spec,
  onChange,
}: VisualizationSettingsProps) {
  const calculation = isCalculationType(spec.calculation)
    ? spec.calculation
    : "last";
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const sparkline = spec.sparkline === true;
  const thresholds = getThresholds(spec);
  const steps = thresholds.steps ?? [];

  const setThresholds = (next: ThresholdsSpec) => {
    onChange({ ...spec, thresholds: { ...next } as Record<string, unknown> });
  };

  const updateStep = (index: number, patch: Partial<ThresholdStep>) => {
    const nextSteps = steps.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    setThresholds({ ...thresholds, steps: nextSteps });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Calculation</Label>
        <ToggleGroup
          value={[calculation]}
          onValueChange={(next) => {
            if (next[0]) onChange({ ...spec, calculation: next[0] });
          }}
          variant="outline"
          size="sm"
        >
          {CALCULATIONS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="stat-unit">Unit</Label>
        <Input
          id="stat-unit"
          value={unit}
          onChange={(e) => onChange({ ...spec, unit: e.target.value })}
          placeholder="e.g. req/s, ms, %"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="stat-sparkline">Sparkline</Label>
        <Switch
          id="stat-sparkline"
          size="sm"
          checked={sparkline}
          onCheckedChange={(checked) =>
            onChange({ ...spec, sparkline: checked })
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Thresholds</Label>
        <ToggleGroup
          value={[thresholds.mode ?? "absolute"]}
          onValueChange={(next) => {
            if (next[0]) {
              setThresholds({
                ...thresholds,
                mode: next[0] as "absolute" | "percent",
              });
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="absolute" aria-label="Absolute">
            Absolute
          </ToggleGroupItem>
          <ToggleGroupItem value="percent" aria-label="Percent">
            Percent
          </ToggleGroupItem>
        </ToggleGroup>

        {steps.map((step, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no stable id
            key={index}
            className="flex items-center gap-2"
          >
            <Input
              type="number"
              value={Number.isFinite(step.value) ? String(step.value) : ""}
              onChange={(e) =>
                updateStep(index, { value: Number(e.target.value) })
              }
              aria-label={`Threshold ${index + 1} value`}
              className="w-24"
            />
            <div className="flex items-center gap-1">
              {THRESHOLD_COLORS.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${label} threshold color`}
                  onClick={() => updateStep(index, { color: value })}
                  className={cn(
                    "size-5 rounded-full border-2",
                    step.color === value
                      ? "border-foreground"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove threshold ${index + 1}`}
              onClick={() =>
                setThresholds({
                  ...thresholds,
                  steps: steps.filter((_, i) => i !== index),
                })
              }
            >
              <X />
            </Button>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setThresholds({
              ...thresholds,
              steps: [...steps, { value: 0, color: THRESHOLD_COLORS[0].value }],
            })
          }
        >
          <Plus data-icon="inline-start" />
          Add threshold
        </Button>
      </div>
    </div>
  );
}
