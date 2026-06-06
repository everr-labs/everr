import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { Play } from "lucide-react";
import type { Panel, PanelQuery } from "@/data/dashboards/schema";
import { SqlEditor } from "./sql-editor";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
  onRunQuery: (sql: string) => void;
  isRunning?: boolean;
}

function getQueryText(draft: Panel): string {
  const firstQuery = draft.spec.queries?.[0];
  if (!firstQuery) return "";
  const querySpec = firstQuery.spec.plugin.spec;
  return typeof querySpec.query === "string" ? querySpec.query : "";
}

function setQueryText(draft: Panel, query: string): Panel {
  const newQuery: PanelQuery = {
    kind: "ClickHouseSQL",
    spec: {
      plugin: {
        kind: "ClickHouseSQL",
        spec: { query },
      },
    },
  };

  return {
    ...draft,
    spec: {
      ...draft.spec,
      queries: [newQuery, ...(draft.spec.queries?.slice(1) ?? [])],
    },
  };
}

export function QueryEditor({
  draft,
  onChange,
  onRunQuery,
  isRunning,
}: QueryEditorProps) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>ClickHouse SQL</Label>
        <Button
          variant="outline"
          size="sm"
          disabled={isRunning || !getQueryText(draft).trim()}
          onClick={() => onRunQuery(getQueryText(draft))}
        >
          <Play data-icon="inline-start" />
          {isRunning ? "Running…" : "Run Query"}
        </Button>
      </div>
      <SqlEditor
        defaultValue={getQueryText(draft)}
        onChange={(text) => onChange(setQueryText(draft, text))}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
