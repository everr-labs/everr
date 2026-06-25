import { auth } from "@/lib/auth.server";
import { AUTH_BASE, AUTH_ISSUER } from "@/lib/mcp-resource";

// The MCP OAuth flow runs inside the client's embedded webview, whose document
// has an opaque origin — so its fetches carry `Origin: null`, which Better
// Auth's origin/CSRF check hard-rejects (before it ever consults
// trustedOrigins). These helpers run set-active / continue / consent
// server-side and present the app's own (trusted) origin instead of forwarding
// the browser's null one, so the check passes. The session still comes from the
// caller's cookie, and the oauth-provider endpoints enforce it.

// Better Auth throws APIError with the useful detail under `.body`
// (error_description for OAuth errors); surface that instead of an empty string.
function oauthFlowError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const body = (
      error as { body?: { error_description?: string; message?: string } }
    ).body;
    if (body?.error_description) return body.error_description;
    if (body?.message) return body.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Forward the caller's session cookie but present the app's own (trusted)
// origin instead of the webview's opaque `null`, so Better Auth's origin/CSRF
// check passes. `accept: application/json` makes the redirecting endpoints
// (continue/consent) return `{ url }` JSON instead of a raw 302.
function trustedHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  const cookie = incoming.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("origin", AUTH_BASE);
  headers.set("accept", "application/json");
  headers.set("sec-fetch-mode", "cors");
  return headers;
}

function serverAuthContext(incoming: Headers, endpointPath: string) {
  const headers = trustedHeaders(incoming);
  // The oauth-provider endpoints also read ctx.request; build it from the same
  // single Headers so the two can't drift.
  const request = new Request(`${AUTH_ISSUER}${endpointPath}`, {
    method: "POST",
    headers,
  });
  return { headers, request };
}

/**
 * Set the caller's active organization server-side. Used by the consent screen's
 * org switcher: the chosen org is what `consentReferenceId` binds into the token
 * when the user approves, so switching is just set-active before Approve.
 */
export async function setActiveOrg(
  incoming: Headers,
  organizationId: string,
): Promise<void> {
  try {
    await auth.api.setActiveOrganization({
      headers: trustedHeaders(incoming),
      body: { organizationId },
    });
  } catch (error) {
    throw new Error(oauthFlowError(error, "Failed to switch organization"));
  }
}

export async function submitConsent(
  incoming: Headers,
  input: { accept: boolean; scope?: string; oauth_query: string },
): Promise<{ url: string }> {
  const { headers, request } = serverAuthContext(incoming, "/oauth2/consent");

  try {
    const result = await auth.api.oauth2Consent({
      headers,
      request,
      asResponse: false,
      body: {
        accept: input.accept,
        scope: input.scope,
        oauth_query: input.oauth_query,
      },
    });

    if (!result?.url) {
      throw new Error("OAuth consent did not return a redirect URL");
    }
    return { url: result.url };
  } catch (error) {
    throw new Error(oauthFlowError(error, "Failed to record consent"));
  }
}
