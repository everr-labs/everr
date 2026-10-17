import { readOrgEntitlement } from "../billing-data.server";
import { resolveRetention } from "../retention";
import type { ProductPolicy } from "@everr/app/composition";
export const productPolicy: ProductPolicy = {
  async forOrganization(orgId) {
    const entitlement = await readOrgEntitlement(orgId);
    return {
      access: entitlement.appState === "suspended" ? "suspended" : "enabled",
      canInviteMembers: entitlement.appState === "pro",
      retention: resolveRetention(entitlement.plan),
    };
  },
};
