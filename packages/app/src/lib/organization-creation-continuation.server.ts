import type { GenericEndpointContext } from "better-auth";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";
import { env } from "@/env";

export const ORGANIZATION_CREATION_COOKIE = "everr.organization-creation";
const MAX_AGE_SECONDS = 600;
const ContinuationSchema = z.object({
  sessionId: z.string(),
  organizationId: z.string(),
  expiresAt: z.number(),
});

export async function markOrganizationCreated(
  session: { id: string; activeOrganizationId: string },
  context: GenericEndpointContext | null,
) {
  if (!context) return;
  const value = await symmetricEncrypt({
    key: env.BETTER_AUTH_SECRET,
    data: JSON.stringify({
      sessionId: session.id,
      organizationId: session.activeOrganizationId,
      expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
    }),
  });
  context.setCookie(ORGANIZATION_CREATION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(env.BETTER_AUTH_URL).protocol === "https:",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readCreatedOrganizationId(
  cookie: string | undefined,
  session: { id: string; activeOrganizationId?: string | null } | undefined,
) {
  if (!cookie || !session) return null;
  try {
    const continuation = ContinuationSchema.parse(
      JSON.parse(
        await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: cookie }),
      ),
    );
    return continuation.sessionId === session.id &&
      continuation.organizationId === session.activeOrganizationId &&
      continuation.expiresAt > Date.now()
      ? continuation.organizationId
      : null;
  } catch {
    return null;
  }
}
