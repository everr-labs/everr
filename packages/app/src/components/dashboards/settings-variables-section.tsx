import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { cn } from "@everr/ui/lib/utils";
import { useSearch } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Variable } from "@/data/dashboards/schema";
import { runVariableOptionsQuery } from "@/data/dashboards/server";
import {
  draftFromVariable,
  emptyDraft,
  type VariableDraft,
  validateDraft,
  variableFromDraft,
  variableKindLabel,
} from "@/data/dashboards/variable-draft";
import { SqlEditor } from "./sql-editor";

export type SettingsSelection =
  | { kind: "general" }
  | { kind: "variable"; index: number }
  | { kind: "new-variable" };

type VariableSelection = Exclude<SettingsSelection, { kind: "general" }>;

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; options: string[]; truncated: boolean };

interface SettingsVariablesSectionProps {
  selection: VariableSelection;
  /** Guarded selection change (user clicks; the page may show confirm-discard). */
  onSelect: (next: SettingsSelection) => void;
  /** Unguarded selection change (post-Apply/Delete moves). */
  onForceSelect: (next: SettingsSelection) => void;
  /** Reports whether the form has un-applied edits (for the page's guard). */
  onUnappliedChange: (hasUnapplied: boolean) => void;
}

export function SettingsVariablesSection({
  selection,
  onSelect,
  onForceSelect,
  onUnappliedChange,
}: SettingsVariablesSectionProps) {
  const variables = useDashboardStore((s) => s.dashboard?.spec.variables) ?? [];

  const selectionKey =
    selection.kind === "new-variable" ? "new" : `var-${selection.index}`;
  const selectedVariable =
    selection.kind === "variable" ? variables[selection.index] : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="w-56 shrink-0 overflow-y-auto border-r p-2">
        <ul className="flex flex-col gap-1">
          {variables.map((variable, index) => (
            <li key={variable.spec.name}>
              <button
                type="button"
                aria-label={`Edit variable ${variable.spec.name}`}
                onClick={() => onSelect({ kind: "variable", index })}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  selection.kind === "variable" &&
                    selection.index === index &&
                    "bg-accent",
                )}
              >
                <div className="truncate font-medium">{variable.spec.name}</div>
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {variableKindLabel(variable)}
                  {variable.kind === "ListVariable" &&
                    variable.spec.allowMultiple && (
                      <Badge variant="secondary">multi</Badge>
                    )}
                  {variable.kind === "ListVariable" &&
                    variable.spec.allowAllValue && (
                      <Badge variant="secondary">all</Badge>
                    )}
                  {variable.spec.display?.hidden && (
                    <Badge variant="secondary">hidden</Badge>
                  )}
                </div>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => onSelect({ kind: "new-variable" })}
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent",
                selection.kind === "new-variable" &&
                  "bg-accent text-foreground",
              )}
            >
              <Plus className="size-3.5" />
              Add variable
            </button>
          </li>
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {selection.kind === "variable" && !selectedVariable ? null : (
          <VariableForm
            key={selectionKey}
            variables={variables}
            editIndex={selection.kind === "variable" ? selection.index : -1}
            onForceSelect={onForceSelect}
            onUnappliedChange={onUnappliedChange}
          />
        )}
      </div>
    </div>
  );
}

function VariableForm({
  variables,
  editIndex,
  onForceSelect,
  onUnappliedChange,
}: {
  variables: Variable[];
  /** -1 = adding a new variable. */
  editIndex: number;
  onForceSelect: (next: SettingsSelection) => void;
  onUnappliedChange: (hasUnapplied: boolean) => void;
}) {
  const updateVariables = useDashboardStore((s) => s.updateVariables);
  const { from, to } = useSearch({ from: "/_authenticated/_dashboard" });

  const editedVariable = editIndex >= 0 ? variables[editIndex] : undefined;
  const [draft, setDraft] = useState<VariableDraft>(() =>
    editedVariable ? draftFromVariable(editedVariable) : emptyDraft(),
  );
  // The Apply baseline: un-applied = draft differs from the last applied draft.
  const [appliedDraft, setAppliedDraft] = useState<VariableDraft>(draft);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const hasUnapplied = JSON.stringify(draft) !== JSON.stringify(appliedDraft);
  useEffect(() => {
    onUnappliedChange(hasUnapplied);
  }, [hasUnapplied, onUnappliedChange]);
  // Clear the flag when this form unmounts (selection switched / page left).
  useEffect(() => () => onUnappliedChange(false), [onUnappliedChange]);

  const patch = (changes: Partial<VariableDraft>) => {
    setFormError(null);
    setDraft((prev) => ({ ...prev, ...changes }));
  };

  const handleApply = () => {
    const takenNames = variables
      .filter((_, i) => i !== editIndex)
      .map((v) => v.spec.name);
    const error = validateDraft(draft, takenNames);
    if (error) {
      setFormError(error);
      return;
    }
    const variable = variableFromDraft(draft);
    if (editIndex === -1) {
      updateVariables([...variables, variable]);
      // Keep the new variable selected (remounts the form at its index).
      onForceSelect({ kind: "variable", index: variables.length });
    } else {
      updateVariables(
        variables.map((v, i) => (i === editIndex ? variable : v)),
      );
      setAppliedDraft(draft);
    }
  };

  const handleDelete = () => {
    updateVariables(variables.filter((_, i) => i !== editIndex));
    onForceSelect(
      variables.length <= 1
        ? { kind: "general" }
        : { kind: "variable", index: Math.max(0, editIndex - 1) },
    );
  };

  const handlePreview = async () => {
    setPreview({ status: "loading" });
    try {
      const result = await runVariableOptionsQuery({
        data: { query: draft.query, from, to },
      });
      setPreview({
        status: "success",
        options: result.options,
        truncated: result.truncated,
      });
    } catch (error) {
      setPreview({
        status: "error",
        message: error instanceof Error ? error.message : "Query failed",
      });
    }
  };

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">
          {editIndex === -1 ? "Add variable" : "Edit variable"}
        </h2>
        <p className="text-xs text-muted-foreground">
          Perses capturingRegexp and sort are accepted in dashboard specs but
          not applied in v1.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Kind</Label>
        <ToggleGroup
          value={[draft.kind]}
          onValueChange={(next: string[]) => {
            const kind = next[0];
            if (kind === "TextVariable" || kind === "ListVariable") {
              patch({ kind });
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="TextVariable">Text</ToggleGroupItem>
          <ToggleGroupItem value="ListVariable">List</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="variable-name">Name</Label>
        <Input
          id="variable-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="service"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="variable-label">Label</Label>
        <Input
          id="variable-label"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
          placeholder="Optional display name"
        />
      </div>

      {draft.kind === "TextVariable" ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="variable-value">Value</Label>
            <Input
              id="variable-value"
              value={draft.value}
              onChange={(e) => patch({ value: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="variable-constant">
              Constant (not editable on the dashboard)
            </Label>
            <Switch
              id="variable-constant"
              size="sm"
              checked={draft.constant}
              onCheckedChange={(checked) => patch({ constant: checked })}
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label>Options</Label>
            <ToggleGroup
              value={[draft.pluginKind]}
              onValueChange={(next: string[]) => {
                const pluginKind = next[0];
                if (
                  pluginKind === "StaticListVariable" ||
                  pluginKind === "ClickHouseSQLVariable"
                ) {
                  patch({ pluginKind });
                }
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="StaticListVariable">
                Static list
              </ToggleGroupItem>
              <ToggleGroupItem value="ClickHouseSQLVariable">
                ClickHouse query
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {draft.pluginKind === "StaticListVariable" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="variable-static-values">
                Values (one per line)
              </Label>
              <Textarea
                id="variable-static-values"
                value={draft.staticValues}
                onChange={(e) => patch({ staticValues: e.target.value })}
                placeholder={"prod\nstaging\ndev"}
                rows={4}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>SQL query</Label>
              <SqlEditor
                defaultValue={draft.query}
                onChange={(sql) => patch({ query: sql })}
                placeholder="SELECT DISTINCT ServiceName FROM logs WHERE Timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}"
                className="h-40"
              />
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!draft.query.trim() || preview.status === "loading"}
                  onClick={handlePreview}
                >
                  {preview.status === "loading"
                    ? "Loading…"
                    : "Preview options"}
                </Button>
              </div>
              {preview.status === "error" && (
                <p className="text-xs text-destructive">{preview.message}</p>
              )}
              {preview.status === "success" && (
                <div className="max-h-32 overflow-y-auto rounded-md border px-2 py-1 text-xs">
                  {preview.options.length === 0 ? (
                    <p className="text-muted-foreground">No options</p>
                  ) : (
                    preview.options.map((option) => (
                      <div key={option} className="truncate">
                        {option}
                      </div>
                    ))
                  )}
                  {preview.truncated && (
                    <p className="text-muted-foreground">First 1000 shown</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="variable-default">
              Default value
              {draft.allowMultiple ? "s (comma-separated)" : ""}
            </Label>
            <Input
              id="variable-default"
              value={draft.defaultValue}
              onChange={(e) => patch({ defaultValue: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="variable-multi">Allow multiple values</Label>
            <Switch
              id="variable-multi"
              size="sm"
              checked={draft.allowMultiple}
              onCheckedChange={(checked) => patch({ allowMultiple: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="variable-all">Allow &quot;All&quot; value</Label>
            <Switch
              id="variable-all"
              size="sm"
              checked={draft.allowAllValue}
              onCheckedChange={(checked) => patch({ allowAllValue: checked })}
            />
          </div>

          {draft.allowAllValue && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="variable-custom-all">
                Custom &quot;All&quot; value (substituted raw)
              </Label>
              <Input
                id="variable-custom-all"
                value={draft.customAllValue}
                onChange={(e) => patch({ customAllValue: e.target.value })}
                placeholder="Leave empty to expand all options"
              />
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <Label htmlFor="variable-hidden">Hidden</Label>
        <Switch
          id="variable-hidden"
          size="sm"
          checked={draft.hidden}
          onCheckedChange={(checked) => patch({ hidden: checked })}
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={handleApply}>Apply</Button>
        {editIndex >= 0 && (
          <Button variant="ghost" onClick={handleDelete}>
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
