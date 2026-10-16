import { productPolicy } from "@app/policy";
import { APIError } from "better-auth/api";

export async function assertCanInviteMembers(orgId: string) {
  if (!(await productPolicy.forOrganization(orgId)).canInviteMembers) {
    throw new APIError("FORBIDDEN", {
      message: "Invitations are unavailable for this organization.",
    });
  }
}
