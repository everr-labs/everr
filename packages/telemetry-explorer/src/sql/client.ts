// The one SQL execution seam every signal repository depends on. Two adapters
// justify it: a ClickHouse client in the web app, and an IPC-backed client in
// the desktop app.
export interface SqlClient {
  execute<Row>(sql: string, params: Record<string, unknown>): Promise<Row[]>;
}
