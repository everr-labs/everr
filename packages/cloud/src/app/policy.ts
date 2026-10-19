import type { ProductPolicy } from "@everr/app/composition";
import { readOrgEntitlement } from "../billing-data.server";
import { resolveRetention } from "../retention";
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
