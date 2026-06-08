/**
 * Form-draft helpers for editing dashboard variables. Pure module shared by
 * the settings page variable form (and previously the variables manager).
 */
import type { Variable } from "./schema";
import { getListVariableSource, VARIABLE_NAME_RE } from "./variable-values";

export interface VariableDraft {
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

export function emptyDraft(): VariableDraft {
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

export function parseStaticValues(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function draftFromVariable(variable: Variable): VariableDraft {
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

function buildVariableFromDraft(draft: VariableDraft): Variable {
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

/**
 * Build a variable from the form draft. When editing (`original` given and the
 * kind is unchanged), preserve fields the form doesn't expose — `display`
 * extras like `description`, list-only `capturingRegexp`/`sort`, extra plugin
 * spec fields, and any other unknown spec keys from imported dashboards — so
 * applying the form doesn't silently drop them. Switching kinds discards the
 * original's kind-specific shape.
 */
export function variableFromDraft(
  draft: VariableDraft,
  original?: Variable,
): Variable {
  const built = buildVariableFromDraft(draft);
  if (!original || original.kind !== built.kind) return built;

  const origSpec = original.spec as Record<string, unknown>;
  const builtSpec = built.spec as Record<string, unknown>;

  // Fields the form fully owns (it sets or clears them); everything else on the
  // original spec is preserved. `display` is handled separately because the
  // form owns only its `name`/`hidden`, not e.g. `description`.
  const ownedKeys =
    built.kind === "TextVariable"
      ? ["name", "value", "constant"]
      : [
          "name",
          "defaultValue",
          "allowMultiple",
          "allowAllValue",
          "customAllValue",
          "plugin",
        ];

  const spec: Record<string, unknown> = { ...origSpec };
  for (const key of ownedKeys) {
    if (key in builtSpec) spec[key] = builtSpec[key];
    else delete spec[key];
  }

  const origDisplay = origSpec.display as Record<string, unknown> | undefined;
  const builtDisplay = builtSpec.display as Record<string, unknown> | undefined;
  const preservedDisplay = { ...origDisplay };
  delete preservedDisplay.name;
  delete preservedDisplay.hidden;
  const display = { ...preservedDisplay, ...builtDisplay };
  if (Object.keys(display).length > 0) spec.display = display;
  else delete spec.display;

  // Preserve extra plugin spec fields when the plugin kind is unchanged.
  if (built.kind === "ListVariable") {
    const origPlugin = origSpec.plugin as
      | { kind?: string; spec?: Record<string, unknown> }
      | undefined;
    const builtPlugin = builtSpec.plugin as
      | { kind?: string; spec?: Record<string, unknown> }
      | undefined;
    if (origPlugin && builtPlugin && origPlugin.kind === builtPlugin.kind) {
      spec.plugin = {
        ...builtPlugin,
        spec: { ...(origPlugin.spec ?? {}), ...(builtPlugin.spec ?? {}) },
      };
    }
  }

  return { kind: built.kind, spec } as Variable;
}

export function validateDraft(
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

export function variableKindLabel(variable: Variable): string {
  if (variable.kind === "TextVariable") return "Text";
  const source = getListVariableSource(variable);
  return source.kind === "query" ? "Query list" : "Static list";
}
