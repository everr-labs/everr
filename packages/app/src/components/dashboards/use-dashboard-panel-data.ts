/* oxlint-disable query/no-unstable-deps -- Preserve the existing per-render panel result identity during the linter migration. */
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { bucketWidthSeconds, usesBucketsParam } from "#app/data/dashboards/buckets.ts";
import {
  extractVariableTokens,
  type VariableMeta,
  type VariableValues,
} from "#app/data/dashboards/interpolate.ts";
import { panelQueryOptions } from "#app/data/dashboards/options.ts";
import type { Panel } from "#app/data/dashboards/schema.ts";
import { pickByNames } from "#app/data/dashboards/variable-values.ts";
import { useTimeRange } from "#app/hooks/use-time-range.ts";
import { getPanelQuerySources, type PanelQuerySource } from "./query-array";
import { useDashboardVariables } from "./use-dashboard-variables";
import { useRetainedPanelData } from "./use-retained-panel-data";
import type { QueryResultRow, ResolvedTimeRange } from "./visualizations";

export interface PanelQueryRequest {
  source: PanelQuerySource;
  variables?: VariableValues;
  variableMeta?: VariableMeta;
  missingName?: string;
  waitingForOptions: boolean;
  /** The SQL references `{buckets}`, so the result depends on the panel width. */
  usesBuckets: boolean;
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

function usedVariableNames(source: PanelQuerySource, ctx: VariableContext): string[] {
  if (source.kind !== "ClickHouseSQL") return [];
  return extractVariableTokens(source.sql).filter((n) => ctx.definedNames.has(n));
}

function buildPanelQueryRequest(
  source: PanelQuerySource,
  ctx: VariableContext,
  usedNames: string[],
): PanelQueryRequest {
  // Only ClickHouse SQL carries `$variable` tokens; other sources skip the
  // whole variable-resolution path (no missing/waiting/options states).
  if (source.kind !== "ClickHouseSQL") {
    return { source, waitingForOptions: false, usesBuckets: false };
  }
  const missingName = usedNames.find((n) => ctx.values[n] === undefined);
  const waitingForOptions = usedNames.some((n) => ctx.pendingAllNames.includes(n));
  const optionsError = usedNames.map((n) => ctx.allErrors[n]).find((e) => e !== undefined);
  return {
    source,
    variables: usedNames.length > 0 ? pickByNames(ctx.values, usedNames) : undefined,
    variableMeta: usedNames.length > 0 ? pickByNames(ctx.meta, usedNames) : undefined,
    missingName,
    waitingForOptions,
    usesBuckets: usesBucketsParam(source.sql),
    optionsError,
  };
}

export function buildPanelQueryRequests(
  sources: PanelQuerySource[],
  ctx: VariableContext,
): PanelQueryRequest[] {
  // Every ClickHouse query in a panel is keyed and gated on the variables used
  // by any of them, so a variable change re-runs the whole panel together.
  // Re-running only the query that uses it would leave its siblings on an
  // older window, and the panel would mix data from two different `now`s.
  const panelNames = [...new Set(sources.flatMap((source) => usedVariableNames(source, ctx)))];
  return sources.map((source) => buildPanelQueryRequest(source, ctx, panelNames));
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
  isPlaceholderData?: boolean;
  isError: boolean;
  error?: unknown;
  rows?: QueryResultRow[];
}

export function combineQueryStates(states: SingleQueryState[]): CombinedPanelResult {
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
        errorMessage: s.error instanceof Error ? s.error.message : String(s.error),
      };
    }
  }

  const active = states.filter((s) => s.active);
  if (active.length === 0) return { status: "success", data: undefined };
  if (active.some((s) => s.isPending || s.isPlaceholderData || s.rows === undefined)) {
    return { status: "pending" };
  }
  return { status: "success", data: active.map((s) => s.rows ?? []) };
}

/**
 * The window the newest fetch queried. The server resolves each query's
 * relative range when it runs, and a multi-query panel's queries can run a few
 * seconds apart, so the latest window is used. Placeholder data belongs to the
 * previous key, so its window is ignored.
 */
export function latestQueriedRange(
  results: readonly { data?: { timeRange?: ResolvedTimeRange }; isPlaceholderData?: boolean }[],
): ResolvedTimeRange | undefined {
  let latest: ResolvedTimeRange | undefined;
  for (const r of results) {
    const range = r.isPlaceholderData ? undefined : r.data?.timeRange;
    if (range && (!latest || range.to.getTime() > latest.to.getTime())) latest = range;
  }
  return latest;
}

export interface DashboardPanelData extends CombinedPanelResult {
  /**
   * Absolute range the visualization renders against (axis domain, brush):
   * the exact window the shown data was queried for.
   */
  timeRange: ResolvedTimeRange;
  /** Width of one `{buckets}` bucket, when a query of the panel uses the parameter. */
  bucketSeconds?: number;
}

/**
 * Everything a dashboard panel needs to render, behind one interface: the
 * effective time range, variable resolution, query building, execution, and
 * result merging. The panel hands in its `panel` spec and gets back
 * `{ status, data, errorMessage, timeRange }` — no time-range threading, no
 * intermediate hooks to coordinate. The variable bar still uses
 * `useDashboardVariables` directly for its pickers.
 */
export function useDashboardPanelData(
  panel: Panel,
  options?: {
    enabled?: boolean;
    /** Bucket count sized to the panel's measured width (`usePanelBuckets`). */
    buckets?: number;
  },
): DashboardPanelData {
  const active = options?.enabled ?? true;
  // Effective range: explicit URL params, else the dashboard's route defaults,
  // else the global default — resolved before first render (no flash). The
  // variable-options queries read the same range internally.
  const { timeRange } = useTimeRange();

  const { variables, values, meta, pendingAllNames, allErrors } = useDashboardVariables();
  const definedNames = useMemo(() => new Set(variables.map((v) => v.spec.name)), [variables]);
  const sources = useMemo(() => getPanelQuerySources(panel), [panel]);
  const buckets = options?.buckets;
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
    queries: requests.map((r) => ({
      ...panelQueryOptions(
        r.source,
        timeRange.from,
        timeRange.to,
        r.variables,
        r.variableMeta,
        r.usesBuckets ? buckets : undefined,
      ),
      placeholderData: keepPreviousData,
      enabled:
        active &&
        sourceIsActive(r.source) &&
        r.missingName === undefined &&
        r.optionsError === undefined &&
        !r.waitingForOptions &&
        (!r.usesBuckets || buckets !== undefined),
    })),
  });

  const combined = useMemo(
    () =>
      combineQueryStates(
        requests.map((r, i) => ({
          active: sourceIsActive(r.source),
          missingName: r.missingName,
          optionsError: r.optionsError,
          isPending: results[i]?.isPending ?? false,
          isPlaceholderData: results[i]?.isPlaceholderData,
          isError: results[i]?.isError ?? false,
          error: results[i]?.error,
          rows: results[i]?.data?.rows,
        })),
      ),
    [requests, results],
  );

  // Before any query has returned there is no queried window yet; resolve the
  // range here so a loading panel still has an axis. Memoize on primitives:
  // `timeRange` is a fresh object each render.
  const { from, to } = timeRange;
  const fallback = useMemo(() => {
    const { fromDate, toDate } = resolveTimeRange({ from, to });
    return { from: fromDate, to: toDate };
  }, [from, to]);
  const queriedRange = latestQueriedRange(results) ?? fallback;
  // Keep the last complete batch and its axis range together while replacement
  // queries finish. A panel can have several queries that resolve separately.
  return useRetainedPanelData(panel, {
    ...combined,
    timeRange: queriedRange,
    bucketSeconds:
      buckets !== undefined && requests.some((r) => r.usesBuckets)
        ? bucketWidthSeconds(queriedRange.from, queriedRange.to, buckets)
        : undefined,
  });
}
