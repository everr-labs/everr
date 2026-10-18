import type { TenantRetention } from "#app/product/retention.ts";

export interface OrganizationPolicy {
  access: "enabled" | "suspended";
  canInviteMembers: boolean;
  retention: TenantRetention;
}
export interface ProductPolicy {
  forOrganization(orgId: string): Promise<OrganizationPolicy>;
}
