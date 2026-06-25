import { getRequest, getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "@/lib/auth.server";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

const SelectOrganizationInputSchema = z.object({
  organizationId: z.string(),
  oauth_query: z.string(),
});

const ConsentInputSchema = z.object({
  accept: z.boolean(),
  scope: z.string().optional(),
  oauth_query: z.string(),
});

function requireOAuthRedirectUrl(result: { url?: string | null }) {
  if (!result.url) {
    throw new Error("OAuth flow did not return a redirect URL");
  }

  return { url: result.url };
}

export const selectMcpOrganization = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(SelectOrganizationInputSchema)
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const request = getRequest();

    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: data.organizationId },
    });

    const result = await auth.api.oauth2Continue({
      headers,
      request,
      asResponse: false,
      body: {
        postLogin: true,
        oauth_query: data.oauth_query,
      },
    });

    return requireOAuthRedirectUrl(result);
  });

export const submitMcpConsent = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(ConsentInputSchema)
  .handler(async ({ data }) => {
    const result = await auth.api.oauth2Consent({
      headers: getRequestHeaders(),
      request: getRequest(),
      asResponse: false,
      body: {
        accept: data.accept,
        scope: data.scope,
        oauth_query: data.oauth_query,
      },
    });

    return requireOAuthRedirectUrl(result);
  });
