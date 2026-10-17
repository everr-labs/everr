import { readOrgEntitlement } from "../billing-data.server";
export async function assertAccountDeletionAllowed(
  organizations: Array<{ id: string; name: string } | null>,
) {
  const owned = organizations.filter((org) => org !== null);
  const entitlements = await Promise.all(
    owned.map((org) => readOrgEntitlement(org.id)),
  );
  const ownedPro = owned.filter(
    (_, index) => entitlements[index].plan === "pro",
  );
  if (ownedPro.length) {
    throw new Error(
      `You can't delete your account while you are an owner of one or more Pro organizations. Transfer ownership of: ${ownedPro.map((org) => org?.name).join(", ")}.`,
    );
  }
}
