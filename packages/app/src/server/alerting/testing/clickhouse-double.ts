import { type ChdbDatabase, createChdbDatabase } from "./chdb-database";

export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  columnTypes: string[];
}

export interface ClickHouseWriteSettings {
  insert_deduplication_token?: string;
}

/**
 * The evaluation-query stub and the history sink are different things, and
 * only one of them is doubled.
 *
 * A rule's query result is this suite's INPUT: a case says "the rule sees a
 * breaching row now, and a clear row on the next tick", and `setRows` is how
 * it says it. The history is this suite's OUTPUT, and it goes to a real
 * ClickHouse (chdb-database.ts), so what the pipeline writes has to survive
 * the shipped DDL's own types, defaults and insert deduplication.
 */
export class ClickHouseDouble {
  private rows: Record<string, unknown>[] = [];
  private failure: Error | null = null;
  private chdb: ChdbDatabase | undefined;

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

  /** Every row app.alert_events actually holds, read back out of it. */
  // fallow-ignore-next-line unused-class-member
  historyRows(): Record<string, unknown>[] {
    return this.database().historyRows();
  }

  /** Ask the engine directly, for cases about the schema's own behaviour. */
  // fallow-ignore-next-line unused-class-member
  queryRows(statement: string): Record<string, unknown>[] {
    return this.database().queryRows(statement);
  }

  /**
   * The harness owns the ClickHouse lifetime, the same way it owns the
   * database and the clock. Booting on first use keeps a suite that never
   * touches history from paying for an engine it does not read.
   */
  private database(): ChdbDatabase {
    if (!this.chdb) this.chdb = createChdbDatabase();
    return this.chdb;
  }

  reset(): void {
    this.rows = [];
    this.failure = null;
    this.chdb?.truncate();
  }

  close(): void {
    this.chdb?.close();
    this.chdb = undefined;
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

  // Deduplication is not simulated here any more: the token goes to the
  // engine, and the table's own non_replicated_deduplication_window decides
  // whether the repeat lands.
  write(rows: object[], settings?: ClickHouseWriteSettings): void {
    this.database().insert(rows, settings?.insert_deduplication_token);
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
