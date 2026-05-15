import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import { auth } from "@/lib/auth.server";

export const INGEST_CONFIG_ID = "ingest";

export type VerifyKeyResponse = {
  tenantId: string;
  keyId: string;
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
        if (!result.valid || !result.key?.referenceId) {
          return new Response(null, { status: 401 });
        }

        const payload: VerifyKeyResponse = {
          tenantId: result.key.referenceId,
          keyId: result.key.id,
        };

        return Response.json(payload);
      },
    },
  },
});
