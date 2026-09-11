export function deriveOrgName(name: string, email: string): string {
  const firstName = name?.split(" ")[0]?.trim() || email.split("@")[0];
  return `${firstName}'s projects`;
}

export function generateOrgSlug(): string {
  return `org-${crypto.randomUUID()}`;
}

export function selectSoleOrganization(
  organizationIds: readonly string[],
): string | null {
  return organizationIds.length === 1 ? organizationIds[0] : null;
}

export function shouldCreateAutomaticOrganization({
  membershipCount,
  hasPendingInvitation,
}: {
  membershipCount: number;
  hasPendingInvitation: boolean;
}): boolean {
  return membershipCount === 0 && !hasPendingInvitation;
}
