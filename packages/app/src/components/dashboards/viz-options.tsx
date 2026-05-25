import type { Panel } from "@/data/dashboards/types";

interface VizOptionsProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

export function VizOptions({ draft, onChange }: VizOptionsProps) {
  return (
    <div className="text-sm text-muted-foreground">
      Visualization options placeholder
    </div>
  );
}
