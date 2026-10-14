export function ingestIdentity(organizationId: string) {
  return { tenantId: organizationId };
}
export function internalIngestHeaders(
  organizationId: string,
): Record<string, string> {
  return { "x-everr-tenant-id": organizationId };
}
