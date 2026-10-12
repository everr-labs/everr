import { z } from "zod";
import { db } from "@/db/client";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { createOnboardingStore } from "./store";

const store = createOnboardingStore(db);
const identityInput = z.object({ organizationId: z.string().min(1) }).strict();

function onboardingScope(
  expectedOrganizationId: string,
  activeOrganizationId: string,
  userId: string,
) {
  if (expectedOrganizationId !== activeOrganizationId)
    throw new Error(
      "Organization changed. Reload this page before continuing.",
    );
  return { organizationId: activeOrganizationId, userId };
}

export const getHomeStatus = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(identityInput)
  .handler(({ data, context: { session } }) =>
    store.getStatus(
      onboardingScope(
        data.organizationId,
        session.session.activeOrganizationId,
        session.user.id,
      ),
    ),
  );

export const completeOnboarding = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(identityInput)
  .handler(({ data, context: { session } }) =>
    store.complete(
      onboardingScope(
        data.organizationId,
        session.session.activeOrganizationId,
        session.user.id,
      ),
    ),
  );
