import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import type { VisualizationSettingsProps } from "../index";

export function TableSettings({ spec, onChange }: VisualizationSettingsProps) {
  const stickyHeader = spec.stickyHeader === true;

  return (
    <div className="flex items-center justify-between">
      <Label htmlFor="table-sticky-header">Sticky header</Label>
      <Switch
        id="table-sticky-header"
        size="sm"
        checked={stickyHeader}
        onCheckedChange={(checked) =>
          onChange({ ...spec, stickyHeader: checked })
        }
      />
    </div>
  );
}
