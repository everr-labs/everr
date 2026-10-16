import { createAutomaticOrganizationSessionHook } from "@/cloud/auto-org.server";
import { db } from "@/db/client";
import { markOrganizationCreated } from "@/lib/organization-creation-continuation.server";
import type { SessionOnboardingHookFactory } from "@/product/onboarding";

export const createSessionOnboardingHook: SessionOnboardingHookFactory = (
  createOrganization,
) =>
  createAutomaticOrganizationSessionHook(
    createOrganization,
    db,
    markOrganizationCreated,
  );
export const beforeUserCreate = async (_user: { email: string }) => undefined;
