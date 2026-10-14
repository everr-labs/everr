export { createAutomaticOrganizationSessionHook as createSessionOnboardingHook } from "@/cloud/auto-org.server";
export const beforeUserCreate = async (_user: { email: string }) => undefined;
