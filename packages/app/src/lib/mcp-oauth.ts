import { env } from "@/env";
import { auth } from "@/lib/auth.server";

// The MCP OAuth flow runs inside the client's embedded webview, whose document
// has an opaque origin — so its fetches carry `Origin: null`, which Better
// Auth's origin/CSRF check hard-rejects (before it ever consults
// trustedOrigins). These helpers run set-active / continue / consent
// server-side and present the app's own (trusted) origin instead of forwarding
// the browser's null one, so the check passes. The session still comes from the
// caller's cookie, and the oauth-provider endpoints enforce it.
const AUTH_BASE = env.BETTER_AUTH_URL.replace(/\/$/, "");

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

function serverAuthContext(incoming: Headers, endpointPath: string) {
  const headers = new Headers();
  const cookie = incoming.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  // A trusted origin (not the webview's opaque `null`) so the origin check
  // passes; `accept: application/json` so continue/consent return `{ url }`
  // JSON instead of a raw 302 redirect we can't follow from here.
  headers.set("origin", AUTH_BASE);
  headers.set("accept", "application/json");

  const proxyHeaders = new Headers(headers);
  proxyHeaders.set("sec-fetch-mode", "cors");
  const request = new Request(`${AUTH_BASE}${endpointPath}`, {
    method: "POST",
    headers: proxyHeaders,
  });

  return { headers, request };
}

export async function selectOrgAndContinue(
  incoming: Headers,
  input: { organizationId: string; oauth_query: string },
): Promise<{ url: string }> {
  const { headers, request } = serverAuthContext(
    incoming,
    "/api/auth/oauth2/continue",
  );

  try {
    await auth.api.setActiveOrganization({
      headers,
      body: { organizationId: input.organizationId },
    });

    const result = await auth.api.oauth2Continue({
      headers,
      request,
      asResponse: false,
      body: { postLogin: true, oauth_query: input.oauth_query },
    });

    if (!result?.url) {
      throw new Error("OAuth continue did not return a redirect URL");
    }
    return { url: result.url };
  } catch (error) {
    throw new Error(oauthFlowError(error, "Failed to select organization"));
  }
}

export async function submitConsent(
  incoming: Headers,
  input: { accept: boolean; scope?: string; oauth_query: string },
): Promise<{ url: string }> {
  const { headers, request } = serverAuthContext(
    incoming,
    "/api/auth/oauth2/consent",
  );

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
