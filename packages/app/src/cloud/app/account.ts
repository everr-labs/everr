export function assertAccountDeletionAllowed(
  organizations: Array<{ name: string; plan: string } | null>,
) {
  const ownedPro = organizations.filter((org) => org?.plan === "pro");
  if (ownedPro.length) {
    throw new Error(
      `You can't delete your account while you are an owner of one or more Pro organizations. Transfer ownership of: ${ownedPro.map((org) => org?.name).join(", ")}.`,
    );
  }
}
