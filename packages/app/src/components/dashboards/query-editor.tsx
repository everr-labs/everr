import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import { Play } from "lucide-react";
import type { Panel, PanelQuery } from "@/data/dashboards/types";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
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

export function QueryEditor({ draft, onChange }: QueryEditorProps) {
  const queryText = getQueryText(draft);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="query-editor">ClickHouse SQL</Label>
          <Button variant="outline" size="sm" disabled>
            <Play data-icon="inline-start" />
            Run Query
          </Button>
        </div>
        <Textarea
          id="query-editor"
          value={queryText}
          onChange={(e) => onChange(setQueryText(draft, e.target.value))}
          placeholder="SELECT * FROM ..."
          className="min-h-32 font-mono text-xs"
        />
      </div>
    </div>
  );
}
