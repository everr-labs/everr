import { createAutomaticOrganizationSessionHook } from "../auto-org.server";
import { db } from "@everr/app/db/client";
import { markOrganizationCreated } from "../organization-provisioning/continuation.server";
import type { SessionOnboardingHookFactory } from "@everr/app/composition";

export const createSessionOnboardingHook: SessionOnboardingHookFactory = (
  createOrganization,
) =>
  createAutomaticOrganizationSessionHook(
    createOrganization,
    db,
    markOrganizationCreated,
  );
export const beforeUserCreate = async (_user: { email: string }) => undefined;
