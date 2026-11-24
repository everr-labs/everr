import type { QueryResultRow } from "#app/components/dashboards/visualizations/index.tsx";

/**
 * A panel's result as ClickHouse's `JSONColumnsWithMetadata` body: under
 * `data`, one array per column, all the same length, in the query's column
 * order. An empty result has no arrays.
 *
 * Panel results cross the server function as this text, unparsed. The
 * serializer then carries one string instead of a node for every row and
 * every value, which made the response about twice ClickHouse's own JSON
 * and most of a panel's decoding time.
 */
export type ColumnsBody = string;

export function columnsBody(rows: readonly QueryResultRow[]): ColumnsBody {
  const columns: Record<string, QueryResultRow[string][]> = {};
  for (const key of Object.keys(rows[0] ?? {})) columns[key] = rows.map((row) => row[key] ?? null);
  return JSON.stringify({ data: columns });
}

export function rowsFromColumns(body: ColumnsBody): QueryResultRow[] {
  const { data }: { data: Record<string, QueryResultRow[string][]> } = JSON.parse(body);
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
