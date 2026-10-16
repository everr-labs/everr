import type { TenantRetention } from "@/product/retention";

export interface OrganizationPolicy {
  access: "enabled" | "suspended";
  canInviteMembers: boolean;
  retention: TenantRetention;
}
export interface ProductPolicy {
  forOrganization(orgId: string): Promise<OrganizationPolicy>;
}
