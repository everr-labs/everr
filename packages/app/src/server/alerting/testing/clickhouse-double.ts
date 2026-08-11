export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  columnTypes: string[];
}

export interface ClickHouseWriteSettings {
  insert_deduplication_token?: string;
}

export class ClickHouseDouble {
  private rows: Record<string, unknown>[] = [];
  private failure: Error | null = null;
  private history: Record<string, unknown>[] = [];
  private seenDeduplicationTokens = new Set<string>();

  /** What the next rule evaluation sees as its query result. */
  // Called only through the harness's `clickhouse` property, which fallow
  // does not trace back to this class through the AlertingHarness interface.
  // fallow-ignore-next-line unused-class-member
  setRows(rows: Record<string, unknown>[]): void {
    this.rows = rows;
    this.failure = null;
  }

  /** What the next rule evaluation throws instead of returning rows. */
  // fallow-ignore-next-line unused-class-member
  setFailure(error: Error | null): void {
    this.failure = error;
  }

  /** Every row written to app.alert_events, in write order. */
  // fallow-ignore-next-line unused-class-member
  historyRows(): Record<string, unknown>[] {
    return this.history;
  }

  reset(): void {
    this.rows = [];
    this.failure = null;
    this.history = [];
    this.seenDeduplicationTokens.clear();
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

  // Real app.alert_events dedups on insert_deduplication_token
  // (non_replicated_deduplication_window, clickhouse/init/12-create-alert-events.sql):
  // a second insert carrying a token already accepted in the window is
  // dropped whole. Every history write already sets this token
  // (alertHistoryDedupToken), so a faithful double has to drop the repeat
  // too, the same way setFailure faithfully simulates the row-cap error.
  write(rows: object[], settings?: ClickHouseWriteSettings): void {
    const token = settings?.insert_deduplication_token;
    if (token !== undefined) {
      if (this.seenDeduplicationTokens.has(token)) return;
      this.seenDeduplicationTokens.add(token);
    }
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
  clickhouse_settings?: ClickHouseWriteSettings,
): Promise<void> {
  activeClickHouse.write(rows, clickhouse_settings);
}

export function createClickhouseQuery() {
  return async <T>(): Promise<T[]> => activeClickHouse.read<T>().rows;
}
