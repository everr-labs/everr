export function selectSoleOrganization(
  organizationIds: readonly string[],
): string | null {
  return organizationIds.length === 1 ? organizationIds[0] : null;
}
