import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { setActiveOrg, submitConsent } from "@/lib/mcp-oauth";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

const ConsentInput = z.object({
  accept: z.boolean(),
  scope: z.string().optional(),
  oauth_query: z.string(),
});

export const submitMcpConsent = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(ConsentInput)
  .handler(async ({ data }) => submitConsent(getRequestHeaders(), data));

// Switch the active org from the consent screen. The newly active org is what
// gets bound into the token when the user approves.
export const setActiveMcpOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ organizationId: z.string() }))
  .handler(async ({ data }) => {
    await setActiveOrg(getRequestHeaders(), data.organizationId);
    return { organizationId: data.organizationId };
  });
