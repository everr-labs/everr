import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
  generateToken,
  isServiceAccountToken,
  TOKEN_TTL_SECONDS,
} from "@/lib/service-account-credentials";
import {
  consumeExchangeAllowance,
  deleteExpiredTokensForSecret,
  findLiveSecret,
  insertToken,
  touchLastUsed,
} from "@/lib/service-account-store";

// The limit is counted on the secret row, so every app instance counts into
// the same place and the key is one the caller cannot choose. It therefore
// reaches only a caller that holds a live secret: an unknown secret has no
// row to count on, and traffic from unknown secrets has to be bounded at the
// proxy or the edge, where an address has an identity behind it. That is not
// a loss, because the limiter never was what stops guessing: the secret is 32
// random bytes.
//
// One secret is shared by a whole CI fleet on purpose, so the number has to
// cover a fleet's burst and not one agent's rate. `everr` exchanges once per
// process, which makes 1200 a minute about 20 process starts a second on a
// single secret: far above what a busy fleet does, and still a bound on what
// one credential can cost in token rows and database work. The window stays
// short because a refused caller has to go quiet for the whole of it, and the
// CLI retries a refusal only once.
const EXCHANGE_LIMIT = { windowMs: 60_000, max: 1200 };

export type ExchangeResult =
  | { status: "issued"; body: { token: string; expires_at: string } }
  | { status: "invalid_secret" }
  | { status: "rate_limited" };

export async function exchangeSecret(secret: string): Promise<ExchangeResult> {
  if (isServiceAccountToken(secret)) {
    return { status: "invalid_secret" };
  }

  const row = await findLiveSecret(secret);
  if (!row) {
    return { status: "invalid_secret" };
  }

  if (!(await consumeExchangeAllowance(row.id, EXCHANGE_LIMIT))) {
    return { status: "rate_limited" };
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  await insertToken({
    id: randomUUID(),
    serviceAccountSecretId: row.id,
    hash: token.hash,
    expiresAt,
  });
  // The redeemed secret is "used" the moment it mints a token, not only
  // when the token is later spent, so the stamp happens here.
  await touchLastUsed(row.serviceAccountId, row.id);
  // A token that is never spent after it expires would otherwise stay
  // forever: validation only deletes a row it is asked to look at. The
  // exchange is the one path that always runs for a busy account, so the
  // cleanup rides along with it instead of needing a sweeper.
  await deleteExpiredTokensForSecret(row.id);

  return {
    status: "issued",
    body: { token: token.value, expires_at: expiresAt.toISOString() },
  };
}

export const Route = createFileRoute("/api/service-accounts/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        // "null" parses as valid JSON, so a non-object body reaches here
        // without throwing and must be rejected before reading .secret.
        if (typeof body !== "object" || body === null) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        const secret = (body as { secret?: unknown }).secret;
        if (typeof secret !== "string") {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        const result = await exchangeSecret(secret);

        if (result.status === "rate_limited") {
          return new Response(null, { status: 429 });
        }

        if (result.status === "invalid_secret") {
          // Unknown, revoked and expired secrets all answer the same, so
          // the response never says which one it was. Malformed bodies are
          // rejected earlier with a 400 and never reach this branch.
          return Response.json({ error: "invalid_secret" }, { status: 401 });
        }

        return Response.json(result.body, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
