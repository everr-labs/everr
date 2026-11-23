import { useTimeRange } from "@everr/telemetry-explorer/shell";
import { useQueries } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";
import type { VariableMeta, VariableValues } from "#app/data/dashboards/interpolate.ts";
import { variableOptionsQueryOptions } from "#app/data/dashboards/options.ts";
import type { Variable } from "#app/data/dashboards/schema.ts";
import {
  buildAllMeta,
  effectiveVariableValues,
  getListVariableSource,
  sortVariableOptions,
} from "#app/data/dashboards/variable-values.ts";
import { useDashboard } from "./use-dashboard";

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
  /** Names set to All whose options can't expand (load failed or truncated). */
  allErrors: Record<string, string>;
  /** Per-list-variable option-loading state for the pickers. */
  optionsState: Record<string, VariableOptionsState>;
}

const EMPTY_VARIABLES: Variable[] = [];

export function useDashboardVariables(): DashboardVariablesState {
  const { vars } = useSearch({
    from: "/_authenticated/_organization/_dashboard",
  });
  // Effective range (URL → route defaults → global), matching the panels.
  const {
    timeRange: { from, to },
  } = useTimeRange();
  const variables = useDashboard().spec.variables ?? EMPTY_VARIABLES;

  // Pair each query-backed variable with its SQL once; results are keyed by
  // variable name below so the lookup never depends on array identity.
  const queryBacked: Array<{ name: string; query: string }> = [];
  for (const variable of variables) {
    if (variable.kind !== "ListVariable") continue;
    const source = getListVariableSource(variable);
    if (source.kind === "query") {
      queryBacked.push({ name: variable.spec.name, query: source.query });
    }
  }
  const optionQueries = useQueries({
    queries: queryBacked.map(({ query }) => variableOptionsQueryOptions(query, from, to)),
  });

  // The last options each query answered, kept through a range change:
  // `useQueries` gives a changed key a fresh observer, so `placeholderData` cannot.
  const [lastOptions, setLastOptions] = useState<Record<string, string[]>>({});
  const answered = queryBacked.flatMap(({ query }, index) => {
    const options = optionQueries[index]?.data?.options;
    return options && lastOptions[query] !== options ? [[query, options] as const] : [];
  });
  if (answered.length > 0) {
    setLastOptions((previous) => ({ ...previous, ...Object.fromEntries(answered) }));
  }
  const queryStateByName = new Map(
    queryBacked.map(({ name }, index) => [name, optionQueries[index]]),
  );

  const optionsState: Record<string, VariableOptionsState> = {};
  for (const variable of variables) {
    if (variable.kind !== "ListVariable") continue;
    const source = getListVariableSource(variable);
    if (source.kind === "static") {
      optionsState[variable.spec.name] = {
        options: sortVariableOptions(source.values, variable.spec.sort),
        isPending: false,
      };
    } else if (source.kind === "query") {
      const query = queryStateByName.get(variable.spec.name);
      const options = query?.data?.options ?? lastOptions[source.query];
      optionsState[variable.spec.name] = {
        options: options ? sortVariableOptions(options, variable.spec.sort) : options,
        // Still pending while it shows the previous range's options: "All" must
        // not resolve against options the new range may not have.
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
  const { meta, pendingAllNames, allErrors } = buildAllMeta(variables, values, optionsState);

  return {
    variables,
    values,
    meta,
    pendingAllNames,
    allErrors,
    optionsState,
  };
}
