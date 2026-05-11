import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apikey } from "@/db/schema";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";

export const INGEST_CONFIG_ID = "ingest";

export type VerifyKeyResponse = {
  tenantId: string;
  keyId: string;
  rateLimit: {
    enabled: boolean;
    max: number | null;
    windowMs: number | null;
    remaining: number | null;
  };
};

function secretMatches(provided: string | null): boolean {
  if (!provided) return false;
  const expected = env.INGEST_VERIFY_SHARED_SECRET;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/internal/verify-key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!secretMatches(request.headers.get("x-internal-secret"))) {
          return new Response(null, { status: 403 });
        }

        let body: { key?: unknown } | null = null;
        try {
          body = (await request.json()) as { key?: unknown };
        } catch {
          return new Response(null, { status: 400 });
        }

        const key = body && typeof body.key === "string" ? body.key : null;
        if (!key) return new Response(null, { status: 400 });

        const result = await auth.api.verifyApiKey({
          body: { key, configId: INGEST_CONFIG_ID },
        });
        if (!result.valid || !result.key) {
          return new Response(null, { status: 401 });
        }

        // Defense in depth: verifyApiKey was already pinned to the ingest
        // config, but re-check on the row in case of plugin behaviour drift.
        const row = await db.query.apikey.findFirst({
          where: eq(apikey.id, result.key.id),
          columns: {
            id: true,
            configId: true,
            referenceId: true,
            enabled: true,
            rateLimitEnabled: true,
            rateLimitMax: true,
            rateLimitTimeWindow: true,
            remaining: true,
          },
        });

        if (
          !row ||
          row.enabled === false ||
          row.configId !== INGEST_CONFIG_ID
        ) {
          return new Response(null, { status: 401 });
        }

        const payload: VerifyKeyResponse = {
          tenantId: row.referenceId,
          keyId: row.id,
          rateLimit: {
            enabled: row.rateLimitEnabled ?? true,
            max: row.rateLimitMax ?? null,
            windowMs: row.rateLimitTimeWindow ?? null,
            remaining: row.remaining ?? null,
          },
        };

        return Response.json(payload);
      },
    },
  },
});
