/** Add the cloud tenant discriminator at the storage boundary. */
export function decorateTelemetryRow<T extends object>(
  organizationId: string,
  row: T,
): T & { tenant_id: string } {
  return { ...row, tenant_id: organizationId };
}
