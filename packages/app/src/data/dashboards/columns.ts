import type { QueryResultRow } from "#app/components/dashboards/visualizations/index.tsx";

/**
 * A panel's result as ClickHouse's `JSONColumnsWithMetadata` body: under
 * `data`, one array per column, all the same length, in the query's column
 * order. An empty result has no arrays.
 */
export type ColumnsBody = string;

type Columns = Record<string, QueryResultRow[string][]>;

/** The window a panel query covered, as ISO strings. */
interface PanelWindow {
  from: string;
  to: string;
}

export function columnsBody(rows: readonly QueryResultRow[]): ColumnsBody {
  const columns: Columns = {};
  for (const key of Object.keys(rows[0] ?? {})) columns[key] = rows.map((row) => row[key] ?? null);
  return JSON.stringify({ data: columns });
}

/**
 * A panel query's reply: ClickHouse's own JSON, never parsed on the server,
 * with the window spliced in. A Response skips the server-function
 * serializer, which wraps every row and every value in a node of its own and
 * made the reply about twice ClickHouse's JSON and most of a panel's
 * decoding time.
 */
export function panelResponse(result: ColumnsBody, timeRange: PanelWindow): Response {
  return new Response(`{"timeRange":${JSON.stringify(timeRange)},"result":${result}}`, {
    headers: { "content-type": "application/json" },
  });
}

export async function readPanelResponse(
  response: Response,
): Promise<{ rows: QueryResultRow[]; timeRange: PanelWindow }> {
  const { timeRange, result }: { timeRange: PanelWindow; result: { data: Columns } } =
    await response.json();
  return { rows: rowsFromColumns(result.data), timeRange };
}

function rowsFromColumns(data: Columns): QueryResultRow[] {
  const entries = Object.entries(data);
  const count = entries[0]?.[1].length ?? 0;
  const rows: QueryResultRow[] = [];
  for (let i = 0; i < count; i++) {
    const row: QueryResultRow = {};
    for (const [key, values] of entries) row[key] = values[i] ?? null;
    rows.push(row);
  }
  return rows;
}
