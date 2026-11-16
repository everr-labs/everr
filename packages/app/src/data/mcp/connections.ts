import { notFound } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "#app/db/client.ts";
import {
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
} from "#app/db/schema/index.ts";
import { describeRedirectUri, type RedirectDestination } from "#app/lib/mcp-redirect-uri.ts";
import { createPartiallyAuthenticatedServerFn } from "#app/lib/serverFn.ts";

export type McpConnection = {
  consentId: string;
  clientId: string;
  /** Self-reported at registration. */
  clientName: string | null;
  destination: RedirectDestination | null;
  organization: { id: string; name: string } | null;
  scopes: string[];
  connectedAt: Date | null;
};

export const listMcpConnections = createPartiallyAuthenticatedServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<McpConnection[]> => {
    const rows = await db
      .select({
        consentId: oauthConsent.id,
        clientId: oauthConsent.clientId,
        clientName: oauthClient.name,
        redirectUris: oauthClient.redirectUris,
        organizationId: organization.id,
        organizationName: organization.name,
        scopes: oauthConsent.scopes,
        connectedAt: oauthConsent.createdAt,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .leftJoin(organization, eq(organization.id, oauthConsent.referenceId))
      .where(eq(oauthConsent.userId, context.session.user.id))
      .orderBy(desc(oauthConsent.createdAt));
    return rows.map(({ redirectUris, organizationId, organizationName, ...row }) => ({
      ...row,
      destination: redirectUris[0] ? describeRedirectUri(redirectUris[0]) : null,
      organization:
        organizationId && organizationName ? { id: organizationId, name: organizationName } : null,
    }));
  },
);

export const revokeMcpConnection = createPartiallyAuthenticatedServerFn({ method: "POST" })
  .validator(z.object({ consentId: z.string() }))
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;
    await db.transaction(async (tx) => {
      const [consent] = await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.id, data.consentId), eq(oauthConsent.userId, userId)))
        .returning({ clientId: oauthConsent.clientId, referenceId: oauthConsent.referenceId });
      if (!consent) throw notFound();
      await tx
        .update(oauthRefreshToken)
        .set({ revoked: new Date() })
        .where(
          and(
            eq(oauthRefreshToken.userId, userId),
            eq(oauthRefreshToken.clientId, consent.clientId),
            consent.referenceId === null
              ? isNull(oauthRefreshToken.referenceId)
              : eq(oauthRefreshToken.referenceId, consent.referenceId),
            isNull(oauthRefreshToken.revoked),
          ),
        );
    });
  });
