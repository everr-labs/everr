import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { TreemapSizeMetric } from "./treemap";

export function getTreemapMetricLabel(metric: TreemapSizeMetric): string {
  if (metric === "avgDuration") return "average duration";
  if (metric === "p95Duration") return "p95 duration";
  return "failure rate";
}

interface TestPerfTreemapMetricToggleProps {
  value: TreemapSizeMetric;
  onChange: (metric: TreemapSizeMetric) => void;
}

export function TestPerfTreemapMetricToggle({
  value,
  onChange,
}: TestPerfTreemapMetricToggleProps) {
  return (
    <ToggleGroup
      value={[value]}
      variant="outline"
      size="sm"
      spacing={0}
      onValueChange={(next) => {
        const selected = next[0];
        if (
          selected === "avgDuration" ||
          selected === "p95Duration" ||
          selected === "failureRate"
        ) {
          onChange(selected);
        }
      }}
      aria-label="Treemap size metric"
    >
      <ToggleGroupItem value="avgDuration" aria-label="Average duration">
        Avg
      </ToggleGroupItem>
      <ToggleGroupItem value="p95Duration" aria-label="P95 duration">
        P95
      </ToggleGroupItem>
      <ToggleGroupItem value="failureRate" aria-label="Failure rate">
        Fail %
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
