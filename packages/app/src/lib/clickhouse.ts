import type { DataFormat } from "@clickhouse/client";
import { storage } from "@composition/storage";
import { env } from "#app/env/index.ts";
import { createClient } from "#app/lib/clickhouse-client.ts";
import { instrumentClickhouseOperation } from "#app/telemetry/clickhouse.ts";

const { appQuerySettings, sqlApiAccess } = storage;

// The client default of 2500ms forces a fresh TLS handshake on most queries
// against servers with a ~10s keep-alive. Set just under the server
// timeout so idle sockets are reused instead of reconnected.
const clickhouseKeepAlive = { idle_socket_ttl: 8000 } as const;

const clickhouse = createClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USERNAME,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  keep_alive: clickhouseKeepAlive,
});

export type ClickhouseQuery = <T>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

type AppQuerySettings = NonNullable<Parameters<typeof clickhouse.query>[0]["clickhouse_settings"]>;

export async function query<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
  // Per-query, not a client default: this client is shared with dashboards,
  // where a global execution-time cap could cut off a legitimate long scan.
  clickhouse_settings?: AppQuerySettings,
): Promise<T[]> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing workspace context");
  }

  const result = await instrumentClickhouseOperation({ client: "app", operation: "QUERY" }, () =>
    clickhouse.query({
      query,
      query_params,
      format: "JSONEachRow",
      clickhouse_settings: appQuerySettings(organizationId, clickhouse_settings),
    }),
  );

  return result.json<T>();
}

/**
 * An App query's rows as JSON lines, unparsed, for a caller that passes them
 * on. Resolves once ClickHouse answers, so a failing query rejects before the
 * caller starts a response. Stopping early, before the first row or while
 * waiting for one, closes the result, which cancels the query and frees its
 * connection.
 */
export async function queryLines(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
  clickhouse_settings?: AppQuerySettings,
): Promise<AsyncIterable<string>> {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing workspace context");
  }

  const result = await instrumentClickhouseOperation({ client: "app", operation: "QUERY" }, () =>
    clickhouse.query({
      query,
      query_params,
      format: "JSONEachRow",
      clickhouse_settings: appQuerySettings(organizationId, clickhouse_settings),
    }),
  );

  const rows = (async function* () {
    for await (const batch of result.stream()) {
      for (const row of batch) yield row.text;
    }
  })();
  // A generator stopped before its first row never runs, and its return()
  // waits behind a next() that is waiting for a row. So stopping closes the
  // result itself, and the read it interrupts ends without an error.
  let stopped = false;
  const done: IteratorResult<string> = { done: true, value: undefined };
  const iterator: AsyncIterator<string> = {
    next: () =>
      rows.next().catch((error: unknown) => {
        if (stopped) return done;
        throw error;
      }),
    return: async () => {
      stopped = true;
      result.close();
      return done;
    },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

export function runSqlApiQuery<Format extends DataFormat>(
  query: string,
  organizationId: string,
  query_params: Record<string, unknown> | undefined,
  format: Format,
  abort_signal?: AbortSignal,
) {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing workspace context");
  }

  const access = sqlApiAccess(organizationId);

  return instrumentClickhouseOperation({ client: "sql_api", operation: "QUERY" }, () =>
    clickhouse.query({
      query,
      query_params,
      format,
      ...(abort_signal ? { abort_signal } : {}),
      ...access,
    }),
  );
}

export async function querySqlApi<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<T[]> {
  if (!organizationId) throw new Error("Missing workspace context");
  const result = await runSqlApiQuery(query, organizationId, query_params, "JSONEachRow");
  return result.json<T>();
}

export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  /** ClickHouse type per column, parallel to `columns` ("" when absent). */
  columnTypes: string[];
}

export async function querySqlApiWithMeta<T>(
  query: string,
  organizationId: string,
  query_params?: Record<string, unknown>,
): Promise<SqlApiResult<T>> {
  if (!organizationId) throw new Error("Missing workspace context");
  // JSON (not JSONEachRow) so column metadata is present even for empty results.
  const result = await runSqlApiQuery(query, organizationId, query_params, "JSON");

  const body = await result.json<T>();
  return {
    rows: body.data ?? [],
    columns: (body.meta ?? []).map((m) => m.name),
    columnTypes: (body.meta ?? []).map((m) => m.type ?? ""),
  };
}

interface SqlApiPreview extends SqlApiResult<unknown[]> {
  /** The query had more than `maxRows` rows; the rest were never read. */
  truncated: boolean;
}

/**
 * Read at most `maxRows` rows of a SQL API query, then cancel it. For callers
 * that show a preview (the MCP tool): ClickHouse stops producing rows when the
 * connection closes, instead of sending up to the profile's result cap to be
 * discarded here. Column names and types arrive even for an empty result.
 */
export async function previewSqlApi(
  query: string,
  organizationId: string,
  maxRows: number,
): Promise<SqlApiPreview> {
  const abort = new AbortController();
  const result = await runSqlApiQuery(
    query,
    organizationId,
    undefined,
    "JSONCompactEachRowWithNamesAndTypes",
    abort.signal,
  );

  // The format always sends two header lines, names then types, before rows.
  const lines: unknown[][] = [];
  let truncated = false;
  try {
    read: for await (const batch of result.stream()) {
      for (const row of batch) {
        if (lines.length - 2 === maxRows) {
          truncated = true;
          break read;
        }
        lines.push(row.json<unknown[]>());
      }
    }
  } finally {
    abort.abort();
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve header values and missing-header behavior from the existing SQL transport.
  const [columns, columnTypes, ...rows] = lines as [string[], string[], ...unknown[][]];
  return { columns, columnTypes, rows, truncated };
}

export function createClickhouseQuery(organizationId: string) {
  return async <T>(sql: string, params?: Record<string, unknown>) =>
    query<T>(sql, organizationId, params);
}
