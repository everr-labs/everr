import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { invitationIdFromRedirect } from "#app/common/invitation.ts";
import type { SessionOnboardingHookFactory } from "#app/composition/onboarding.ts";
import { assertInvitedUser } from "./installation.server";

export const createSessionOnboardingHook: SessionOnboardingHookFactory =
  () => async () => {};
export async function beforeUserCreate(
  user: { email: string; emailVerified?: boolean },
  context: GenericEndpointContext | null,
) {
  const callbackURL = context?.body?.callbackURL;
  const invitationId = invitationIdFromRedirect(
    typeof callbackURL === "string" ? callbackURL : undefined,
  );
  try {
    await assertInvitedUser(user, invitationId);
  } catch {
    throw new APIError("FORBIDDEN", {
      message: "Contact your administrator for an invitation.",
    });
  }
}
