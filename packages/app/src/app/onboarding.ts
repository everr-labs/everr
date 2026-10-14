import { APIError } from "better-auth/api";
import type { createAutomaticOrganizationSessionHook } from "@/lib/auto-org.server";
import { assertInvitedUser } from "./installation.server";

export const createSessionOnboardingHook: typeof createAutomaticOrganizationSessionHook =
  () => async () => {};
export async function beforeUserCreate(user: { email: string }) {
  try {
    await assertInvitedUser(user.email);
  } catch {
    throw new APIError("FORBIDDEN", {
      message: "Contact your administrator for an invitation.",
    });
  }
}
export const requireVerifiedInvitation = true;
