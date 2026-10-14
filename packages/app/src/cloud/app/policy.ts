import { readOrgEntitlement } from "@/cloud/billing-data.server";
import { resolveRetention } from "@/cloud/retention";
import type { ProductPolicy } from "@/product/policy";
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
