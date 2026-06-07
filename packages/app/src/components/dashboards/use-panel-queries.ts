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
import { getQueryTexts } from "./query-array";
import { useDashboardVariables } from "./use-dashboard-variables";
import type { QueryResultRow } from "./visualizations";

export interface PanelQueryRequest {
  sql: string;
  variables?: VariableValues;
  variableMeta?: VariableMeta;
  missingName?: string;
  waitingForOptions: boolean;
}

interface VariableContext {
  definedNames: Set<string>;
  values: VariableValues;
  meta: VariableMeta;
  pendingAllNames: string[];
}

export function buildPanelQueryRequests(
  sqls: string[],
  ctx: VariableContext,
): PanelQueryRequest[] {
  return sqls.map((sql) => {
    const usedNames = extractVariableTokens(sql).filter((n) =>
      ctx.definedNames.has(n),
    );
    const missingName = usedNames.find((n) => ctx.values[n] === undefined);
    const waitingForOptions = usedNames.some((n) =>
      ctx.pendingAllNames.includes(n),
    );
    return {
      sql,
      variables:
        usedNames.length > 0 ? pickByNames(ctx.values, usedNames) : undefined,
      variableMeta:
        usedNames.length > 0 ? pickByNames(ctx.meta, usedNames) : undefined,
      missingName,
      waitingForOptions,
    };
  });
}

export type PanelQueriesStatus = "pending" | "error" | "success";

export interface CombinedPanelResult {
  status: PanelQueriesStatus;
  data?: QueryResultRow[][];
  errorMessage?: string;
}

export interface SingleQueryState {
  sql: string;
  missingName?: string;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  rows?: QueryResultRow[];
}

export function combineQueryStates(
  states: SingleQueryState[],
): CombinedPanelResult {
  for (const s of states) {
    if (s.sql.trim().length === 0) continue;
    if (s.missingName !== undefined) {
      return {
        status: "error",
        errorMessage: `Select a value for $${s.missingName}`,
      };
    }
    if (s.isError) {
      return {
        status: "error",
        errorMessage:
          s.error instanceof Error ? s.error.message : String(s.error),
      };
    }
  }

  const active = states.filter((s) => s.sql.trim().length > 0);
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
  queryEnabled?: (sql: string, index: number) => boolean;
}

export function usePanelQueries(
  panel: Panel,
  opts: UsePanelQueriesOptions = {},
): CombinedPanelResult {
  const { variables, values, meta, pendingAllNames } = useDashboardVariables();
  const definedNames = useMemo(
    () => new Set(variables.map((v) => v.spec.name)),
    [variables],
  );
  const sqls = useMemo(() => getQueryTexts(panel), [panel]);
  const requests = useMemo(
    () =>
      buildPanelQueryRequests(sqls, {
        definedNames,
        values,
        meta,
        pendingAllNames,
      }),
    [sqls, definedNames, values, meta, pendingAllNames],
  );

  const results = useQueries({
    queries: requests.map((r, i) => ({
      ...panelQueryOptions(
        r.sql,
        opts.from,
        opts.to,
        r.variables,
        r.variableMeta,
      ),
      enabled:
        (opts.enabled ?? true) &&
        r.sql.trim().length > 0 &&
        r.missingName === undefined &&
        !r.waitingForOptions &&
        (opts.queryEnabled?.(r.sql, i) ?? true),
    })),
  });

  return useMemo(
    () =>
      combineQueryStates(
        requests.map((r, i) => ({
          sql: r.sql,
          missingName: r.missingName,
          isPending: results[i]?.isPending ?? false,
          isError: results[i]?.isError ?? false,
          error: results[i]?.error,
          rows: results[i]?.data?.rows,
        })),
      ),
    [requests, results],
  );
}
