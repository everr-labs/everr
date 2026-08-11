// fallow-ignore-file unused-file
// Not imported yet: the smoke test that mocks @/lib/clickhouse with this
// module lands in a later task, in the same pipeline-test-harness plan.
export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  columnTypes: string[];
}

export class ClickHouseDouble {
  private rows: Record<string, unknown>[] = [];
  private failure: Error | null = null;
  private history: Record<string, unknown>[] = [];

  /** What the next rule evaluation sees as its query result. */
  setRows(rows: Record<string, unknown>[]): void {
    this.rows = rows;
    this.failure = null;
  }

  /** What the next rule evaluation throws instead of returning rows. */
  setFailure(error: Error | null): void {
    this.failure = error;
  }

  /** Every row written to app.alert_events, in write order. */
  historyRows(): Record<string, unknown>[] {
    return this.history;
  }

  reset(): void {
    this.rows = [];
    this.failure = null;
    this.history = [];
  }

  read<T>(): SqlApiResult<T> {
    if (this.failure) throw this.failure;
    const columns = Object.keys(this.rows[0] ?? {});
    return {
      rows: this.rows as T[],
      columns,
      columnTypes: columns.map(() => "String"),
    };
  }

  write(rows: object[]): void {
    this.history.push(...(rows as Record<string, unknown>[]));
  }
}

export const activeClickHouse = new ClickHouseDouble();

export async function querySqlApiWithMeta<T>(): Promise<SqlApiResult<T>> {
  return activeClickHouse.read<T>();
}

export async function querySqlApi<T>(): Promise<T[]> {
  return activeClickHouse.read<T>().rows;
}

export async function query<T>(): Promise<T[]> {
  return activeClickHouse.read<T>().rows;
}

export async function insertAdminRows(
  _table: string,
  rows: object[],
): Promise<void> {
  activeClickHouse.write(rows);
}

export function createClickhouseQuery() {
  return async <T>(): Promise<T[]> => activeClickHouse.read<T>().rows;
}
