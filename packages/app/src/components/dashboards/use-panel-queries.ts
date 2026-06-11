import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  extractVariableTokens,
  type VariableMeta,
  type VariableValues,
} from "@/data/dashboards/interpolate";
import { panelQueryOptions } from "@/data/dashboards/options";
import type { Panel } from "@/data/dashboards/schema";
import { pickByNames } from "@/data/dashboards/variable-values";
import { getPanelQuerySources, type PanelQuerySource } from "./query-array";
import { useDashboardVariables } from "./use-dashboard-variables";
import type { QueryResultRow } from "./visualizations";

export interface PanelQueryRequest {
  source: PanelQuerySource;
  variables?: VariableValues;
  variableMeta?: VariableMeta;
  missingName?: string;
  waitingForOptions: boolean;
  /** A used All-variable whose options failed to load or were truncated. */
  optionsError?: string;
}

export interface VariableContext {
  definedNames: Set<string>;
  values: VariableValues;
  meta: VariableMeta;
  pendingAllNames: string[];
  allErrors: Record<string, string>;
}

/** A source runs if it has something to execute. `none` never runs. */
function sourceIsActive(source: PanelQuerySource): boolean {
  if (source.kind === "ClickHouseSQL") return source.sql.trim().length > 0;
  return source.kind === "TestData";
}

export function buildPanelQueryRequest(
  source: PanelQuerySource,
  ctx: VariableContext,
): PanelQueryRequest {
  // Only ClickHouse SQL carries `$variable` tokens; other sources skip the
  // whole variable-resolution path (no missing/waiting/options states).
  if (source.kind !== "ClickHouseSQL") {
    return { source, waitingForOptions: false };
  }
  const usedNames = extractVariableTokens(source.sql).filter((n) =>
    ctx.definedNames.has(n),
  );
  const missingName = usedNames.find((n) => ctx.values[n] === undefined);
  const waitingForOptions = usedNames.some((n) =>
    ctx.pendingAllNames.includes(n),
  );
  const optionsError = usedNames
    .map((n) => ctx.allErrors[n])
    .find((e) => e !== undefined);
  return {
    source,
    variables:
      usedNames.length > 0 ? pickByNames(ctx.values, usedNames) : undefined,
    variableMeta:
      usedNames.length > 0 ? pickByNames(ctx.meta, usedNames) : undefined,
    missingName,
    waitingForOptions,
    optionsError,
  };
}

export function buildPanelQueryRequests(
  sources: PanelQuerySource[],
  ctx: VariableContext,
): PanelQueryRequest[] {
  return sources.map((source) => buildPanelQueryRequest(source, ctx));
}

export type PanelQueriesStatus = "pending" | "error" | "success";

export interface CombinedPanelResult {
  status: PanelQueriesStatus;
  data?: QueryResultRow[][];
  errorMessage?: string;
}

export interface SingleQueryState {
  active: boolean;
  missingName?: string;
  optionsError?: string;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  rows?: QueryResultRow[];
}

export function combineQueryStates(
  states: SingleQueryState[],
): CombinedPanelResult {
  for (const s of states) {
    if (!s.active) continue;
    if (s.missingName !== undefined) {
      return {
        status: "error",
        errorMessage: `Select a value for $${s.missingName}`,
      };
    }
    if (s.optionsError !== undefined) {
      return { status: "error", errorMessage: s.optionsError };
    }
    if (s.isError) {
      return {
        status: "error",
        errorMessage:
          s.error instanceof Error ? s.error.message : String(s.error),
      };
    }
  }

  const active = states.filter((s) => s.active);
  if (active.length === 0) return { status: "success", data: undefined };
  if (active.some((s) => s.isPending || s.rows === undefined)) {
    return { status: "pending" };
  }
  return { status: "success", data: active.map((s) => s.rows ?? []) };
}

export interface UsePanelQueriesOptions {
  from?: string;
  to?: string;
  enabled?: boolean;
  queryEnabled?: (source: PanelQuerySource, index: number) => boolean;
}

export function usePanelQueries(
  panel: Panel,
  opts: UsePanelQueriesOptions = {},
): CombinedPanelResult {
  const { variables, values, meta, pendingAllNames, allErrors } =
    useDashboardVariables();
  const definedNames = useMemo(
    () => new Set(variables.map((v) => v.spec.name)),
    [variables],
  );
  const sources = useMemo(() => getPanelQuerySources(panel), [panel]);
  const requests = useMemo(
    () =>
      buildPanelQueryRequests(sources, {
        definedNames,
        values,
        meta,
        pendingAllNames,
        allErrors,
      }),
    [sources, definedNames, values, meta, pendingAllNames, allErrors],
  );

  const results = useQueries({
    queries: requests.map((r, i) => ({
      ...panelQueryOptions(
        r.source,
        opts.from,
        opts.to,
        r.variables,
        r.variableMeta,
      ),
      enabled:
        (opts.enabled ?? true) &&
        sourceIsActive(r.source) &&
        r.missingName === undefined &&
        r.optionsError === undefined &&
        !r.waitingForOptions &&
        (opts.queryEnabled?.(r.source, i) ?? true),
    })),
  });

  return useMemo(
    () =>
      combineQueryStates(
        requests.map((r, i) => ({
          active: sourceIsActive(r.source),
          missingName: r.missingName,
          optionsError: r.optionsError,
          isPending: results[i]?.isPending ?? false,
          isError: results[i]?.isError ?? false,
          error: results[i]?.error,
          rows: results[i]?.data?.rows,
        })),
      ),
    [requests, results],
  );
}
