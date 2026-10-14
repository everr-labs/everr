export { createAutomaticOrganizationSessionHook as createSessionOnboardingHook } from "@/lib/auto-org.server";
export const beforeUserCreate = async (_user: { email: string }) => undefined;
export const requireVerifiedInvitation = false;
