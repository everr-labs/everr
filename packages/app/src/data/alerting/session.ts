export function alertingOrganizationId(session: {
  session: { activeOrganizationId: string };
}): string {
  return session.session.activeOrganizationId;
}
