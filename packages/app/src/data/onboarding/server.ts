import { deployment } from "@composition/deployment";

import { z } from "zod";
import type { HomeStatus } from "#app/common/onboarding.ts";
import { db } from "#app/db/client.ts";
import { env } from "#app/env/index.ts";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import { createOnboardingStore } from "./store";

import { events } from "#app/server/events/runtime.ts";

const store = createOnboardingStore(db, events);
const identityInput = z.object({ organizationId: z.string().min(1) }).strict();

function onboardingScope(
  expectedOrganizationId: string,
  activeOrganizationId: string,
  userId: string,
) {
  if (expectedOrganizationId !== activeOrganizationId)
    throw new Error("Organization changed. Reload this page before continuing.");
  return { organizationId: activeOrganizationId, userId };
}

export const getHomeStatus = createAuthenticatedServerFn({ method: "GET" })
  .validator(identityInput)
  .handler(async ({ data, context: { session } }): Promise<HomeStatus> => ({
    ...(await store.getStatus(
      onboardingScope(data.organizationId, session.session.activeOrganizationId, session.user.id),
    )),
    ingestEndpoint: deployment.ingestEndpoint,
    appUrl: env.BETTER_AUTH_URL,
  }));

export const completeOnboarding = createAuthenticatedServerFn({
  method: "POST",
})
  .validator(identityInput)
  .handler(({ data, context: { session } }) =>
    store.complete(
      onboardingScope(data.organizationId, session.session.activeOrganizationId, session.user.id),
    ),
  );
