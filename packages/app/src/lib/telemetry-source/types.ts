/**
 * The seam between a feature and wherever its telemetry actually lives.
 *
 * Everything above this interface is backend-agnostic: a repository builds SQL
 * and calls `execute`, and which implementation it got is the only difference
 * between reading from the cloud and reading from the local collector.
 *
 * Structurally identical to the `SqlClient` that `@everr/telemetry-explorer`
 * already defines for its traces, logs and errors repositories, so the panel
 * path uses the same shape the other telemetry surfaces do.
 */
export interface SqlClient {
  execute<Row>(sql: string, params: Record<string, unknown>): Promise<Row[]>;
}

/** Which backend the active `SqlClient` reads from. */
export type TelemetrySourceKind = "cloud" | "local";
