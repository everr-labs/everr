import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { Play, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Panel } from "@/data/dashboards/schema";
import {
  addQuery,
  getQueryTextAt,
  getQueryTexts,
  removeQueryAt,
  setQueryTextAt,
} from "./query-array";
import { SqlEditor } from "./sql-editor";

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
  onRunQuery: (index: number) => void;
  runningIndex?: number | null;
}

const QUERY_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function queryLabel(index: number): string {
  return QUERY_LABELS[index] ?? String(index + 1);
}

export function QueryEditor({
  draft,
  onChange,
  onRunQuery,
  runningIndex,
}: QueryEditorProps) {
  const texts = getQueryTexts(draft);
  // Render at least one editor even when the panel has no queries yet; the
  // first edit seeds queries[0] via setQueryTextAt.
  const rendered = texts.length > 0 ? texts : [""];

  // Stable ids per row so removing a middle query doesn't remount the wrong
  // uncontrolled SqlEditor. Grown lazily to the rendered length; spliced on
  // remove so ids stay aligned with rows.
  //
  // The id list is grow-only and is reconciled only against this component's
  // own add/remove handlers. It is NOT reconciled against external wholesale
  // replacement of draft.spec.queries. If a caller replaces the queries array
  // out-of-band, the parent must remount this component (via a key prop) so
  // the id list is reset alongside the new query set.
  const idsRef = useRef<number[]>([]);
  const nextIdRef = useRef(0);
  while (idsRef.current.length < rendered.length) {
    idsRef.current.push(nextIdRef.current++);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {rendered.map((text, index) => (
        <div key={idsRef.current[index]} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Query {queryLabel(index)} · ClickHouse SQL</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={runningIndex === index || !text.trim()}
                onClick={() => onRunQuery(index)}
              >
                <Play data-icon="inline-start" />
                {runningIndex === index ? "Running…" : "Run Query"}
              </Button>
              {rendered.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove query"
                  onClick={() => {
                    idsRef.current.splice(index, 1);
                    onChange(removeQueryAt(draft, index));
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
          <SqlEditor
            defaultValue={getQueryTextAt(draft, index)}
            onChange={(value) => onChange(setQueryTextAt(draft, index, value))}
            className="min-h-32"
          />
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange(addQuery(draft))}
      >
        <Plus data-icon="inline-start" />
        Add query
      </Button>
    </div>
  );
}
