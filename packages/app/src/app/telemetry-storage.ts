/** Telemetry rows share a table without a tenant discriminator. */
export function decorateTelemetryRow<T extends object>(
  _organizationId: string,
  row: T,
): T {
  return row;
}
