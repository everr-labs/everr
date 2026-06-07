import { Button } from "@everr/ui/components/button";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import {
  dashboardModelJsonSchema,
  dashboardModelSchema,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";
import { JsonEditor, type JsonEditorSchema } from "./json-editor";

// zod's generated draft-7 schema is structurally what codemirror-json-schema
// expects; the cast bridges the two libraries' JSON Schema typings.
const editorSchema = dashboardModelJsonSchema as JsonEditorSchema;

interface SettingsJsonSectionProps {
  /** Reports whether the editor has un-applied edits (for the page's guard). */
  onUnappliedChange: (hasUnapplied: boolean) => void;
}

export function SettingsJsonSection({
  onUnappliedChange,
}: SettingsJsonSectionProps) {
  const dashboard = useDashboardStore((s) => s.dashboard);
  const sourceSlug = useDashboardStore((s) => s.sourceSlug);
  const patchDashboard = useDashboardStore((s) => s.patchDashboard);

  // Baseline = the last serialized/applied document. The editor remounts
  // (key={revision}) after Apply so it shows the committed, normalized JSON.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(dashboard, null, 2),
  );
  const [text, setText] = useState(baseline);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasUnapplied = text !== baseline;
  useEffect(() => {
    onUnappliedChange(hasUnapplied);
  }, [hasUnapplied, onUnappliedChange]);
  // Clear the flag when this section unmounts (selection switched / page left).
  useEffect(() => () => onUnappliedChange(false), [onUnappliedChange]);

  if (!dashboard) return null;

  const handleApply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = dashboardModelSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      setError(
        issue
          ? `${issue.path.join(".") || "document"}: ${issue.message}`
          : "Invalid dashboard document",
      );
      return;
    }
    // A CHANGED name must be a valid (non-reserved) slug; the untouched
    // current identity — existing slug or the "new" draft sentinel — passes.
    const currentName = sourceSlug ?? "new";
    if (result.data.metadata.name !== currentName) {
      const slugCheck = dashboardSlugSchema.safeParse(
        result.data.metadata.name,
      );
      if (!slugCheck.success) {
        setError(
          `metadata.name: ${slugCheck.error.issues[0]?.message ?? "invalid slug"}`,
        );
        return;
      }
    }
    patchDashboard(result.data);
    const next = JSON.stringify(result.data, null, 2);
    setBaseline(next);
    setText(next);
    setRevision((r) => r + 1);
    setError(null);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        The full Perses dashboard model. Changing{" "}
        <code className="font-mono">metadata.name</code> renames the dashboard
        URL slug when you Save.
      </p>
      <JsonEditor
        key={revision}
        schema={editorSchema}
        defaultValue={text}
        onChange={(value) => {
          setError(null);
          setText(value);
        }}
        className="min-h-0 flex-1"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button onClick={handleApply}>Apply</Button>
      </div>
    </div>
  );
}
