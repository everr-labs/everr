import { APIError } from "better-auth/api";
import type { SessionOnboardingHookFactory } from "@/product/onboarding";
import { assertInvitedUser } from "./installation.server";

export const createSessionOnboardingHook: SessionOnboardingHookFactory =
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
