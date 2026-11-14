import { z } from "zod";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import { GithubRepositorySchema } from "./infer";
import { releaseHeldIssues } from "#app/data/alerting/delivery/held-issues.server.ts";
import { serviceRepositoryLinks, setServiceRepository } from "./links.server";

export const getServiceRepositoryLinks = createAuthenticatedServerFn({ method: "GET" })
  .validator(z.object({ environment: z.string().trim().min(1).max(64).optional() }))
  .handler(({ data, context }) =>
    serviceRepositoryLinks(context.session.session.activeOrganizationId, data.environment),
  );

export const linkServiceRepository = createAuthenticatedServerFn({ method: "POST" })
  .validator(
    z.object({
      service: z.string().trim().min(1).max(256),
      repository: GithubRepositorySchema.nullable(),
    }),
  )
  .handler(({ data, context: { session } }) =>
    setServiceRepository(
      session.session.activeOrganizationId,
      session.user.id,
      data.service,
      data.repository,
    ),
  );

/** Send the issues waiting for a service whose repository Everr now knows,
 *  for example after it started sending `vcs.repository.url.full`. */
export const sendHeldServiceIssues = createAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ service: z.string().trim().min(1).max(256) }))
  .handler(async ({ data, context }): Promise<{ sent: number }> => ({
    sent: await releaseHeldIssues(context.session.session.activeOrganizationId, data.service),
  }));
