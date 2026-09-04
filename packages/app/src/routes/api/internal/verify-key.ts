import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/env";
import { hasApiKeyScope } from "@/lib/api-key-scopes";
import { auth } from "@/lib/auth.server";
import { originPolicyAllows } from "@/lib/public-ingest-keys";
import { retentionForOrg } from "@/lib/retention.server";

const INGEST_CONFIG_ID = "ingest";

type VerifyKeyResponse = {
  tenantId: string;
  keyId: string;
  // Retention in days per signal. The collector stamps these on every
  // resource it ingests with this key and the views write them into
  // app.*, so this is the only place retention enters the pipeline.
  logsDays: number;
  tracesDays: number;
  metricsDays: number;
};

type VerifyBody = {
  key?: unknown;
  origin?: unknown;
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

        let body: VerifyBody | null = null;
        try {
          body = (await request.json()) as VerifyBody;
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

        const retention = await retentionForOrg(result.key.referenceId);
        const payload: VerifyKeyResponse = {
          tenantId: result.key.referenceId,
          keyId: result.key.id,
          logsDays: retention.logsDays,
          tracesDays: retention.tracesDays,
          metricsDays: retention.metricsDays,
        };

        return Response.json(payload);
      },
    },
  },
});
