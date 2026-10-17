import { product } from "@composition/product";
import { APIError } from "better-auth/api";

export async function assertCanInviteMembers(orgId: string) {
  if (!(await product.canInviteMembers(orgId))) {
    throw new APIError("FORBIDDEN", {
      message: "Invitations are unavailable for this organization.",
    });
  }
}
