import type { IdentityPolicy } from "@everr/app/composition";
import { IdentityPolicyError } from "@everr/app/identity/policy-error";
import type { createBillingModule } from "../billing/module";
import { BillingError } from "../billing/types";

type BillingIdentity = Pick<
  ReturnType<typeof createBillingModule>,
  | "beforeUserDelete"
  | "beforeMembershipChange"
  | "afterMembershipChange"
  | "assertDeletable"
>;

export function createCloudIdentityPolicy({
  billing,
  readOrgEntitlement,
}: {
  billing: BillingIdentity;
  readOrgEntitlement(
    organizationId: string,
  ): Promise<{ plan: "hobby" | "pro" }>;
}): IdentityPolicy {
  const enforce = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      if (
        error instanceof BillingError &&
        (error.code === "owner_required" || error.code === "forbidden")
      )
        throw new IdentityPolicyError(error.message, { cause: error });
      throw error;
    }
  };
  return {
    async beforeUserCreate() {},
    async assertAccountDeletionAllowed(organizations) {
      const entitlements = await Promise.all(
        organizations.map(({ id }) => readOrgEntitlement(id)),
      );
      const ownedPro = organizations.filter(
        (_, index) => entitlements[index].plan === "pro",
      );
      if (ownedPro.length) {
        throw new IdentityPolicyError(
          `You can't delete your account while you are an owner of one or more Pro organizations. Transfer ownership of: ${ownedPro.map(({ name }) => name).join(", ")}.`,
        );
      }
    },
    beforeUserDelete: (userId) =>
      enforce(() => billing.beforeUserDelete(userId)),
    beforeMembershipChange: (organizationId, userId, role) =>
      enforce(() =>
        billing.beforeMembershipChange(organizationId, userId, role),
      ),
    afterMembershipChange: (organizationId) =>
      enforce(() => billing.afterMembershipChange(organizationId)),
    assertDeletable: (organizationId) =>
      enforce(() => billing.assertDeletable(organizationId)),
  };
}
