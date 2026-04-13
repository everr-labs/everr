export function deriveOrgName(name: string, email: string): string {
  const firstName = name?.split(" ")[0]?.trim() || email.split("@")[0];
  return `${firstName}'s workspace`;
}

export function generateOrgSlug(): string {
  return `org-${crypto.randomUUID()}`;
}
