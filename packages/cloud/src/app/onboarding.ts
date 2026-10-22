import type { SessionOnboardingHookFactory } from "@everr/app/composition";
import { db } from "@everr/app/db/client";
import { createAutomaticOrganizationSessionHook } from "../auto-org.server";
import { markOrganizationCreated } from "../organization-provisioning/continuation.server";

export const createSessionOnboardingHook: SessionOnboardingHookFactory = (
  createOrganization,
) =>
  createAutomaticOrganizationSessionHook(
    createOrganization,
    db,
    markOrganizationCreated,
  );
