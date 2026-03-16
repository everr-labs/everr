import { getGlobalStartContext } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { getTenantForOrganizationId } from "@/data/tenants";
import { getBearerToken, validateAccessToken } from "./access-token-auth";

export type EverrSession = {
  userId: string;
  organizationId: string;
  sessionId: string | undefined;
  tenantId: number;
};

export async function getAccessTokenSessionFromRequest(
  request: Request,
): Promise<EverrSession | null> {
  const token = getBearerToken(request.headers);

  if (token) {
    const auth = await validateAccessToken(token);

    if (auth) {
      const session: EverrSession = {
        userId: auth.userId,
        organizationId: auth.organizationId,
        sessionId: undefined,
        tenantId: auth.tenantId,
      };

      return session;
    }
  }

  return null;
}

export async function getWorkOSAuthSession(): Promise<EverrSession | null> {
  const auth = await getAuth();

  if (!auth.user) {
    console.error("[auth] no user found");
    return null;
  }
  if (!auth.organizationId) {
    console.error("[auth] no organization found");
    return null;
  }

  const tenantId = await getTenantForOrganizationId(auth.organizationId);

  if (!tenantId) {
    console.error("[auth] no tenant found");
    return null;
  }

  return {
    userId: auth.user.id,
    organizationId: auth.organizationId,
    sessionId: auth.sessionId,
    tenantId,
  };
}

export function requireEverrSession() {
  const ctx = getGlobalStartContext() as { session?: EverrSession } | undefined;

  if (!ctx?.session) throw new Error("Unauthorized");

  return ctx.session;
}
