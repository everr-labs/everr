import type { Panel } from "@/data/dashboards/types";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
}

export function QueryEditor({ draft, onChange }: QueryEditorProps) {
  return (
    <div className="text-sm text-muted-foreground">
      Query editor placeholder
    </div>
  );
}
