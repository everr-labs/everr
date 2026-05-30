export interface SqlClient {
  execute<Row>(sql: string, params: Record<string, unknown>): Promise<Row[]>;
}
