import {
  type ChdbDatabase,
  createChdbDatabase,
  type QueryParams,
} from "./chdb-database";

export interface SqlApiResult<T> {
  rows: T[];
  columns: string[];
  columnTypes: string[];
}

interface ClickHouseWriteSettings {
  insert_deduplication_token?: string;
}

/**
 * What the alerting suite gets instead of `@/lib/clickhouse`.
 *
 * Nothing here is a double any more. A rule's SQL runs against a real
 * ClickHouse (chdb, see chdb-database.ts), the rows it reads come from a real
 * table the case wrote, and the history it writes goes through the shipped
 * `app.alert_events` DDL. The column names and types this hands back are the
 * engine's own, so a rule whose query returns a column of the wrong type is
 * wrong here in the same way it is wrong in production.
 *
 * The one thing this cannot speak to is tenant isolation. Embedded chdb has
 * no access control, so the grants and the row policy in the shipped DDL are
 * skipped and every read here runs unrestricted. The org id is required, the
 * way production requires it, and then it scopes nothing: a query that reads
 * another tenant's rows is not caught here.
 */
export class TestClickHouse {
  private chdb: ChdbDatabase | undefined;

  /** What `app.test_signal` holds, which is what a default rule selects. */
  // Called only through the harness's `clickhouse` property, which fallow
  // does not trace back to this class through the AlertingHarness interface.
  // fallow-ignore-next-line unused-class-member
  setSignal(rows: Record<string, unknown>[]): void {
    this.database().setSignal(rows);
  }

  /** Every row app.alert_events actually holds, read back out of it. */
  // fallow-ignore-next-line unused-class-member
  historyRows(): Record<string, unknown>[] {
    return this.database().historyRows();
  }

  /** Ask the engine directly, for cases about the schema's own behaviour. */
  // fallow-ignore-next-line unused-class-member
  queryRows(
    statement: string,
    params?: QueryParams,
  ): Record<string, unknown>[] {
    return this.database().queryRows(statement, params);
  }

  /**
   * The harness owns the ClickHouse lifetime, the same way it owns the
   * database and the clock. Booting on first use keeps a suite that never
   * touches ClickHouse from paying for an engine it does not read.
   */
  private database(): ChdbDatabase {
    if (!this.chdb) this.chdb = createChdbDatabase();
    return this.chdb;
  }

  reset(): void {
    this.chdb?.setSignal([]);
    this.chdb?.truncate();
  }

  close(): void {
    this.chdb?.close();
    this.chdb = undefined;
  }

  read<T>(statement: string, params?: QueryParams): SqlApiResult<T> {
    const result = this.database().runQuery(statement, params);
    return {
      rows: result.rows as T[],
      columns: result.columns,
      columnTypes: result.columnTypes,
    };
  }

  // Deduplication is the engine's: the token goes to the table, and its own
  // non_replicated_deduplication_window decides whether the repeat lands.
  write(rows: object[], settings?: ClickHouseWriteSettings): void {
    this.database().insert(rows, settings?.insert_deduplication_token);
  }
}

export const activeClickHouse = new TestClickHouse();

/**
 * The tenant check production makes before it reaches ClickHouse at all.
 *
 * It cannot enforce isolation here (that is a row policy, and there is none),
 * but the check itself is not about isolation: it is production refusing to
 * run a query whose caller never established a tenant context. A stand-in
 * that accepted `undefined` would let such a call site pass in tests and
 * throw in production, which is the one failure a stand-in must not hide.
 */
function requireTenant(organizationId: string): void {
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error("Missing ClickHouse tenant context");
  }
}

export async function querySqlApiWithMeta<T>(
  statement: string,
  organizationId: string,
  query_params?: QueryParams,
): Promise<SqlApiResult<T>> {
  requireTenant(organizationId);
  return activeClickHouse.read<T>(statement, query_params);
}

export async function querySqlApi<T>(
  statement: string,
  organizationId: string,
  query_params?: QueryParams,
): Promise<T[]> {
  requireTenant(organizationId);
  return activeClickHouse.read<T>(statement, query_params).rows;
}

export async function query<T>(
  statement: string,
  organizationId: string,
  query_params?: QueryParams,
): Promise<T[]> {
  requireTenant(organizationId);
  return activeClickHouse.read<T>(statement, query_params).rows;
}

export async function insertAdminRows(
  _table: string,
  rows: object[],
  clickhouse_settings?: ClickHouseWriteSettings,
): Promise<void> {
  activeClickHouse.write(rows, clickhouse_settings);
}

export function createClickhouseQuery(organizationId: string) {
  requireTenant(organizationId);
  return async <T>(
    statement: string,
    query_params?: QueryParams,
  ): Promise<T[]> => activeClickHouse.read<T>(statement, query_params).rows;
}
