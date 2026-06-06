import { useQueries } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useDashboardStore } from "@/data/dashboards/dashboard-store";
import type {
  VariableMeta,
  VariableValues,
} from "@/data/dashboards/interpolate";
import { variableOptionsQueryOptions } from "@/data/dashboards/options";
import type { ListVariable, Variable } from "@/data/dashboards/schema";
import {
  buildAllMeta,
  effectiveVariableValues,
  getListVariableSource,
} from "@/data/dashboards/variable-values";

export interface VariableOptionsState {
  options?: string[];
  isPending: boolean;
  error?: string;
  truncated?: boolean;
}

export interface DashboardVariablesState {
  variables: Variable[];
  /** Effective values (URL wins, then spec defaults). Missing = absent key. */
  values: VariableValues;
  /** All-expansion metadata for variables currently set to the All sentinel. */
  meta: VariableMeta;
  /** Names set to All whose options have not loaded yet — hold panel queries. */
  pendingAllNames: string[];
  /** Per-list-variable option-loading state for the pickers. */
  optionsState: Record<string, VariableOptionsState>;
}

const EMPTY_VARIABLES: Variable[] = [];

export function useDashboardVariables(): DashboardVariablesState {
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const { from, to, vars } = search;
  const variables =
    useDashboardStore((s) => s.dashboard?.spec.variables) ?? EMPTY_VARIABLES;

  const queryBacked = variables.filter(
    (v): v is ListVariable =>
      v.kind === "ListVariable" && getListVariableSource(v).kind === "query",
  );
  const optionQueries = useQueries({
    queries: queryBacked.map((v) => {
      const source = getListVariableSource(v);
      return variableOptionsQueryOptions(
        source.kind === "query" ? source.query : "",
        from,
        to,
      );
    }),
  });

  const optionsState: Record<string, VariableOptionsState> = {};
  for (const variable of variables) {
    if (variable.kind !== "ListVariable") continue;
    const source = getListVariableSource(variable);
    if (source.kind === "static") {
      optionsState[variable.spec.name] = {
        options: source.values,
        isPending: false,
      };
    } else if (source.kind === "query") {
      const query = optionQueries[queryBacked.indexOf(variable)];
      optionsState[variable.spec.name] = {
        options: query?.data?.options,
        isPending: query?.isPending ?? true,
        error: query?.error
          ? query.error instanceof Error
            ? query.error.message
            : String(query.error)
          : undefined,
        truncated: query?.data?.truncated,
      };
    } else {
      optionsState[variable.spec.name] = { options: [], isPending: false };
    }
  }

  const values = effectiveVariableValues(variables, vars);
  const { meta, pendingAllNames } = buildAllMeta(
    variables,
    values,
    optionsState,
  );

  return { variables, values, meta, pendingAllNames, optionsState };
}
