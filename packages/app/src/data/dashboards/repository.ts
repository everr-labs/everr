import { bucketSeconds } from "@everr/ui/lib/bucket";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import type { SqlClient } from "@/lib/telemetry-source/types";
import type { VariableMeta, VariableValues } from "./interpolate";
import { interpolateVariables } from "./interpolate";
import { generateTestData } from "./testdata/generate";
import { testDataSpec } from "./testdata/spec";

/** A time-series panel targets ~this many points; `step` is sized to hit it. */
const PANEL_TARGET_POINTS = 500;

/**
 * Hard-capped by the SQL API profile's `max_result_rows` (clickhouse/init/
 * 15-create-sql-api-role.sql). That profile uses result_overflow_mode='throw',
 * so a query returning more than this ERRORS rather than truncating — the cap
 * must be enforced in SQL (see withRowLimit), not after the fetch. The local
 * collector caps by result bytes instead, so the wrapper matters there too.
 */
export const VARIABLE_OPTIONS_LIMIT = 1000;

export type QueryRow = Record<string, string | number | boolean | null>;

/**
 * A panel source that can actually be run. The wider `PanelQuerySource` in
 * query-array also carries `none`, which the caller filters out before it gets
 * here.
 */
export type ExecutablePanelSource =
  | { kind: "ClickHouseSQL"; sql: string }
  | { kind: "TestData"; spec: Record<string, unknown> };

export interface PanelQueryInput {
  source: ExecutablePanelSource;
  from?: string;
  to?: string;
  variables?: VariableValues;
  variableMeta?: VariableMeta;
}

export interface VariableOptionsInput {
  query: string;
  from?: string;
  to?: string;
}

/**
 * The ClickHouse query parameters bound to every dashboard query (panel and
 * variable-options alike), so the documented contract — `{from}`/`{to}` plus an
 * adaptive `{step:UInt32}` bucket width — holds for all of them by construction.
 * `from`/`to` are the resolved range; `step` is the adaptive bucket width
 * (seconds) so a chart can `toStartOfInterval(col, INTERVAL {step:UInt32}
 * SECOND)` and stay ~bounded in point count at any zoom. Queries that don't
 * reference a parameter simply ignore it.
 */
function dashboardQueryParams(range: { from?: string; to?: string }) {
  const { fromDate, toDate, fromISO, toISO } = resolveTimeRange({
    from: range.from ?? DEFAULT_TIME_RANGE.from,
    to: range.to ?? DEFAULT_TIME_RANGE.to,
  });
  return {
    from: fromISO,
    to: toISO,
    step: bucketSeconds(fromDate, toDate, PANEL_TARGET_POINTS),
  };
}

/**
 * Bound a user-supplied options query to at most `limit` rows by wrapping it,
 * so the SQL API profile never throws on overflow. Wrapping (vs appending
 * `LIMIT`) preserves any `ORDER BY`/`LIMIT` the query already has; the trailing
 * semicolon is stripped so the subquery stays valid.
 */
function withRowLimit(query: string, limit: number): string {
  const inner = query.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (\n${inner}\n) LIMIT ${limit}`;
}

/**
 * The data path for dashboard and runbook panels, in the same shape as the
 * traces, logs and errors repositories in `@everr/telemetry-explorer`: build
 * SQL, hand it to an injected `SqlClient`, map what comes back.
 *
 * Holding interpolation and parameter binding here (rather than behind a server
 * function) is what lets the cloud and local backends stay in step: there is one
 * implementation of both, not a server copy and a client copy that can drift.
 */
export class PanelRepository {
  constructor(private readonly client: SqlClient) {}

  async runPanel(input: PanelQueryInput): Promise<{ rows: QueryRow[] }> {
    const { source, from, to, variables, variableMeta } = input;
    const params = dashboardQueryParams({ from, to });

    // Synthetic data for the gallery / dev dashboards: deterministic, no
    // backend at all, no tenant data. Reuses the same range + adaptive {step}.
    if (source.kind === "TestData") {
      // Parse the loose spec here (not at the edge) so callers can pass the raw
      // plugin spec. A malformed spec throws → surfaces as a panel query error;
      // the gallery's specs are validated at apply time.
      const spec = testDataSpec.parse(source.spec);
      return { rows: generateTestData(spec, params) };
    }

    const sql = variables
      ? interpolateVariables(source.sql, variables, variableMeta ?? {})
      : source.sql;

    const rows = await this.client.execute<QueryRow>(sql, params);
    return { rows };
  }

  async runVariableOptions(
    input: VariableOptionsInput,
  ): Promise<{ options: string[]; truncated: boolean }> {
    const { query, from, to } = input;

    // Bind the same parameters as a panel query (including `{step}`) so an
    // options query can reference any of them without erroring.
    const rows = await this.client.execute<Record<string, unknown>>(
      withRowLimit(query, VARIABLE_OPTIONS_LIMIT),
      dashboardQueryParams({ from, to }),
    );

    // A full result set means the backend cut rows off at the limit, so there
    // may be more options than we can show — surface that as truncation.
    const truncated = rows.length >= VARIABLE_OPTIONS_LIMIT;

    // Options are the stringified first column, deduplicated, in query order.
    const seen = new Set<string>();
    const options: string[] = [];
    for (const row of rows) {
      const values = Object.values(row);
      if (values.length === 0) continue;
      const option = String(values[0]);
      if (seen.has(option)) continue;
      seen.add(option);
      options.push(option);
    }
    return { options, truncated };
  }
}
