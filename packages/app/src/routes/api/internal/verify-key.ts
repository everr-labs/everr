import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import { hasApiKeyScope } from "@/lib/api-key-scopes";
import { auth } from "@/lib/auth.server";
import { originPolicyAllows } from "@/lib/public-ingest-keys";

const INGEST_CONFIG_ID = "ingest";

type VerifyKeyResponse = {
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

        let body: { key?: unknown; origin?: unknown } | null = null;
        try {
          body = (await request.json()) as {
            key?: unknown;
            origin?: unknown;
          };
        } catch {
          return new Response(null, { status: 400 });
        }

        const key = body && typeof body.key === "string" ? body.key : null;
        if (!key) return new Response(null, { status: 400 });
        // The collector forwards the request's Origin header verbatim and
        // omits the field for server-to-server (headerless) traffic.
        const origin =
          body && typeof body.origin === "string" ? body.origin : null;

        const result = await auth.api.verifyApiKey({
          body: { key, configId: INGEST_CONFIG_ID },
        });
        if (!result.valid || !result.key?.referenceId) {
          return new Response(null, { status: 401 });
        }

        // Even though the key is valid and resolves to an org, it must carry
        // the `ingest` scope. A key minted for `apply` only must not be
        // honored here — that would let a CI token exfiltrate telemetry.
        if (!hasApiKeyScope(result.key.permissions, "ingest", "write")) {
          return new Response(null, { status: 403 });
        }

        // Browser policy: public keys only work from an allowed Origin;
        // secret keys never work from a browser (Origin-bearing request).
        if (!originPolicyAllows(result.key.metadata, origin)) {
          return new Response(null, { status: 403 });
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
