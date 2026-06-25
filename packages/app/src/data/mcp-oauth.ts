import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { selectOrgAndContinue, submitConsent } from "@/lib/mcp-oauth";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

const SelectOrganizationInput = z.object({
  organizationId: z.string(),
  oauth_query: z.string(),
});

const ConsentInput = z.object({
  accept: z.boolean(),
  scope: z.string().optional(),
  oauth_query: z.string(),
});

// Run set-active + resume authorization server-side. See lib/mcp-oauth.ts for
// why this can't be a plain browser authClient call (opaque webview origin).
export const selectMcpOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(SelectOrganizationInput)
  .handler(async ({ data }) =>
    selectOrgAndContinue(getRequestHeaders(), data),
  );

export const submitMcpConsent = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(ConsentInput)
  .handler(async ({ data }) => submitConsent(getRequestHeaders(), data));
