import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import type { VisualizationSettingsProps } from "../index";

export function TableSettings({ spec, onChange }: VisualizationSettingsProps) {
  const stickyHeader = spec.stickyHeader === true;

  return (
    <div className="flex flex-col gap-2">
      <Label>Header</Label>
      <ToggleGroup
        value={stickyHeader ? ["stickyHeader"] : []}
        onValueChange={(next) =>
          onChange({ ...spec, stickyHeader: next.includes("stickyHeader") })
        }
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="stickyHeader" aria-label="Sticky header">
          Sticky header
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
