import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import { Textarea } from "@everr/ui/components/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { useSearch } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type { Variable } from "@/data/dashboards/schema";
import { runVariableOptionsQuery } from "@/data/dashboards/server";
import {
  getListVariableSource,
  VARIABLE_NAME_RE,
} from "@/data/dashboards/variable-values";

interface VariableDraft {
  kind: "TextVariable" | "ListVariable";
  name: string;
  label: string;
  hidden: boolean;
  // TextVariable
  value: string;
  constant: boolean;
  // ListVariable
  pluginKind: "StaticListVariable" | "ClickHouseSQLVariable";
  staticValues: string; // textarea, one value per line
  query: string;
  defaultValue: string; // comma-separated when allowMultiple
  allowMultiple: boolean;
  allowAllValue: boolean;
  customAllValue: string;
}

function emptyDraft(): VariableDraft {
  return {
    kind: "ListVariable",
    name: "",
    label: "",
    hidden: false,
    value: "",
    constant: false,
    pluginKind: "StaticListVariable",
    staticValues: "",
    query: "",
    defaultValue: "",
    allowMultiple: false,
    allowAllValue: false,
    customAllValue: "",
  };
}

function parseStaticValues(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function draftFromVariable(variable: Variable): VariableDraft {
  const base = {
    ...emptyDraft(),
    name: variable.spec.name,
    label: variable.spec.display?.name ?? "",
    hidden: variable.spec.display?.hidden === true,
  };
  if (variable.kind === "TextVariable") {
    return {
      ...base,
      kind: "TextVariable" as const,
      value: variable.spec.value,
      constant: variable.spec.constant === true,
    };
  }
  const source = getListVariableSource(variable);
  return {
    ...base,
    kind: "ListVariable" as const,
    pluginKind:
      source.kind === "query" ? "ClickHouseSQLVariable" : "StaticListVariable",
    staticValues: source.kind === "static" ? source.values.join("\n") : "",
    query: source.kind === "query" ? source.query : "",
    defaultValue: Array.isArray(variable.spec.defaultValue)
      ? variable.spec.defaultValue.join(", ")
      : (variable.spec.defaultValue ?? ""),
    allowMultiple: variable.spec.allowMultiple === true,
    allowAllValue: variable.spec.allowAllValue === true,
    customAllValue: variable.spec.customAllValue ?? "",
  };
}

function variableFromDraft(draft: VariableDraft): Variable {
  const name = draft.name.trim();
  const display =
    draft.label.trim() || draft.hidden
      ? {
          ...(draft.label.trim() ? { name: draft.label.trim() } : {}),
          ...(draft.hidden ? { hidden: true } : {}),
        }
      : undefined;
  if (draft.kind === "TextVariable") {
    return {
      kind: "TextVariable",
      spec: {
        name,
        ...(display ? { display } : {}),
        value: draft.value,
        ...(draft.constant ? { constant: true } : {}),
      },
    };
  }
  // Known limitation: comma-separated input means option values containing
  // commas cannot be used as multi-select defaults.
  const defaults = draft.defaultValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultValue = draft.allowMultiple
    ? defaults.length > 0
      ? defaults
      : undefined
    : defaults[0];
  return {
    kind: "ListVariable",
    spec: {
      name,
      ...(display ? { display } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(draft.allowMultiple ? { allowMultiple: true } : {}),
      ...(draft.allowAllValue ? { allowAllValue: true } : {}),
      ...(draft.allowAllValue && draft.customAllValue
        ? { customAllValue: draft.customAllValue }
        : {}),
      plugin:
        draft.pluginKind === "StaticListVariable"
          ? {
              kind: "StaticListVariable",
              spec: { values: parseStaticValues(draft.staticValues) },
            }
          : { kind: "ClickHouseSQLVariable", spec: { query: draft.query } },
    },
  };
}

function validateDraft(
  draft: VariableDraft,
  takenNames: string[],
): string | null {
  const name = draft.name.trim();
  if (!VARIABLE_NAME_RE.test(name)) {
    return "Name must start with a letter or underscore and contain only letters, digits and underscores";
  }
  if (takenNames.includes(name)) {
    return `A variable named "${name}" already exists`;
  }
  if (draft.kind === "ListVariable") {
    if (
      draft.pluginKind === "StaticListVariable" &&
      parseStaticValues(draft.staticValues).length === 0
    ) {
      return "Add at least one value (one per line)";
    }
    if (draft.pluginKind === "ClickHouseSQLVariable" && !draft.query.trim()) {
      return "Query is required";
    }
  }
  return null;
}

function variableKindLabel(variable: Variable): string {
  if (variable.kind === "TextVariable") return "Text";
  const source = getListVariableSource(variable);
  return source.kind === "query" ? "Query list" : "Static list";
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; options: string[]; truncated: boolean };

interface VariablesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VariablesManager({
  open,
  onOpenChange,
}: VariablesManagerProps) {
  const variables = useDashboardStore((s) => s.dashboard?.spec.variables) ?? [];
  const updateVariables = useDashboardStore((s) => s.updateVariables);
  const { from, to } = useSearch({ from: "/_authenticated/_dashboard" });

  // null = list view; -1 = adding; >= 0 = editing that index.
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<VariableDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  const openList = () => {
    setEditIndex(null);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const startAdd = () => {
    setDraft(emptyDraft());
    setEditIndex(-1);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const startEdit = (index: number) => {
    const variable = variables[index];
    if (!variable) return;
    setDraft(draftFromVariable(variable));
    setEditIndex(index);
    setFormError(null);
    setPreview({ status: "idle" });
  };

  const handleDelete = (index: number) => {
    updateVariables(variables.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
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
    } else if (editIndex !== null) {
      updateVariables(
        variables.map((v, i) => (i === editIndex ? variable : v)),
      );
    }
    openList();
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

  const patch = (changes: Partial<VariableDraft>) => {
    setFormError(null);
    setDraft((prev) => ({ ...prev, ...changes }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) openList();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {editIndex === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Variables</DialogTitle>
              <DialogDescription>
                Reference variables in panel SQL as $name. Changes are saved
                with the dashboard.
              </DialogDescription>
            </DialogHeader>
            {variables.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No variables yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {variables.map((variable, index) => (
                  <li
                    key={variable.spec.name}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {variable.spec.name}
                      </div>
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
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Edit variable ${variable.spec.name}`}
                      onClick={() => startEdit(index)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete variable ${variable.spec.name}`}
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={startAdd}>
                <Plus data-icon="inline-start" />
                Add Variable
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {editIndex === -1 ? "Add variable" : "Edit variable"}
              </DialogTitle>
              <DialogDescription>
                Perses capturingRegexp and sort are accepted in dashboard specs
                but not applied in v1.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
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
                      onCheckedChange={(checked) =>
                        patch({ constant: checked })
                      }
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
                        onChange={(e) =>
                          patch({ staticValues: e.target.value })
                        }
                        placeholder={"prod\nstaging\ndev"}
                        rows={4}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variable-query">SQL query</Label>
                      <Textarea
                        id="variable-query"
                        value={draft.query}
                        onChange={(e) => patch({ query: e.target.value })}
                        placeholder="SELECT DISTINCT ServiceName FROM logs WHERE Timestamp BETWEEN {from:DateTime64} AND {to:DateTime64}"
                        rows={4}
                        className="font-mono text-xs"
                      />
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            !draft.query.trim() || preview.status === "loading"
                          }
                          onClick={handlePreview}
                        >
                          {preview.status === "loading"
                            ? "Loading…"
                            : "Preview options"}
                        </Button>
                      </div>
                      {preview.status === "error" && (
                        <p className="text-xs text-destructive">
                          {preview.message}
                        </p>
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
                            <p className="text-muted-foreground">
                              First 1000 shown
                            </p>
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
                    <Label htmlFor="variable-multi">
                      Allow multiple values
                    </Label>
                    <Switch
                      id="variable-multi"
                      size="sm"
                      checked={draft.allowMultiple}
                      onCheckedChange={(checked) =>
                        patch({ allowMultiple: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="variable-all">
                      Allow &quot;All&quot; value
                    </Label>
                    <Switch
                      id="variable-all"
                      size="sm"
                      checked={draft.allowAllValue}
                      onCheckedChange={(checked) =>
                        patch({ allowAllValue: checked })
                      }
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
                        onChange={(e) =>
                          patch({ customAllValue: e.target.value })
                        }
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

              {formError && (
                <p className="text-sm text-destructive">{formError}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={openList}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>
                {editIndex === -1 ? "Add" : "Update"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
