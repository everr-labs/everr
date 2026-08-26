import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  member,
  serviceAccount,
  serviceAccountSecret,
  serviceAccountToken,
  user,
} from "@/db/schema";
import { serverLogger } from "@/telemetry/logger";
import { hashCredential } from "./service-account-credentials";

export async function findLiveToken(tokenValue: string) {
  const rows = await db
    .select({
      id: serviceAccountToken.id,
      expiresAt: serviceAccountToken.expiresAt,
      // The organization comes from the membership, the same as for a person.
      organizationId: member.organizationId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    })
    .from(serviceAccountToken)
    .innerJoin(
      serviceAccountSecret,
      eq(serviceAccountSecret.id, serviceAccountToken.serviceAccountSecretId),
    )
    .innerJoin(
      serviceAccount,
      eq(serviceAccount.id, serviceAccountSecret.serviceAccountId),
    )
    .innerJoin(user, eq(user.id, serviceAccount.userId))
    // An inner join: with no membership there is no organization to act in,
    // so the token resolves to nothing rather than to a session with no
    // tenant.
    .innerJoin(member, eq(member.userId, serviceAccount.userId))
    // A revoked secret takes its tokens with it, so revocation is immediate.
    .where(
      and(
        eq(serviceAccountToken.hash, hashCredential(tokenValue)),
        isNull(serviceAccountSecret.revokedAt),
      ),
    )
    // Two rows are all it takes to see that the membership is ambiguous.
    .limit(2);

  const [row, second] = rows;
  if (!row) {
    return null;
  }

  if (second) {
    // The guards hold a service account to one membership, but no database
    // constraint can express "exactly one across all organizations", so a
    // second row is possible. Picking one would let the agent act in an
    // organization nobody chose, and nothing downstream would notice. A
    // refused agent is an incident someone investigates; a silent
    // cross-tenant one is not.
    serverLogger.error("service_account.membership.ambiguous", {
      "user.id": row.user.id,
      "everr.organization.id": row.organizationId,
      "everr.service_account.other_organization.id": second.organizationId,
    });
    return null;
  }

  return row;
}

export async function deleteToken(id: string) {
  await db.delete(serviceAccountToken).where(eq(serviceAccountToken.id, id));
}

// Validation deletes a token row only when someone presents that token
// after it expired, so a token nobody spends again would stay forever. The
// exchange runs for every live secret in use, which makes it the place to
// drop what that secret already burned through.
export async function deleteExpiredTokensForSecret(secretId: string) {
  await db
    .delete(serviceAccountToken)
    .where(
      and(
        eq(serviceAccountToken.serviceAccountSecretId, secretId),
        lt(serviceAccountToken.expiresAt, new Date()),
      ),
    );
}

export async function touchLastUsed(
  serviceAccountId: string,
  secretId: string,
) {
  const now = new Date();
  await Promise.all([
    db
      .update(serviceAccount)
      .set({ lastUsedAt: now })
      .where(eq(serviceAccount.id, serviceAccountId)),
    db
      .update(serviceAccountSecret)
      .set({ lastUsedAt: now })
      .where(eq(serviceAccountSecret.id, secretId)),
  ]);
}

export async function findLiveSecret(secretValue: string) {
  const [row] = await db
    .select({
      id: serviceAccountSecret.id,
      serviceAccountId: serviceAccountSecret.serviceAccountId,
    })
    .from(serviceAccountSecret)
    .where(
      and(
        eq(serviceAccountSecret.hash, hashCredential(secretValue)),
        isNull(serviceAccountSecret.revokedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}

// Returns false when the secret has already spent its allowance for the
// window it is in, which is the caller's signal to refuse the exchange.
export async function consumeExchangeAllowance(
  secretId: string,
  limit: { windowMs: number; max: number },
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - limit.windowMs);
  const windowExpired = sql`(${isNull(serviceAccountSecret.lastRequest)} or ${lte(serviceAccountSecret.lastRequest, windowStart)})`;

  // One statement carries the whole decision: the same test that lets the row
  // through the WHERE clause also decides whether the count restarts at one or
  // grows by one. Postgres locks the row for the update and makes a second
  // writer re-test the guard against the committed row, so two exchanges that
  // arrive together cannot both take the last unit of the allowance. Reading
  // the count and writing it back would let both read the same number.
  const [row] = await db
    .update(serviceAccountSecret)
    .set({
      requestCount: sql`case when ${windowExpired} then 1 else ${serviceAccountSecret.requestCount} + 1 end`,
      lastRequest: now,
    })
    .where(
      and(
        eq(serviceAccountSecret.id, secretId),
        or(windowExpired, lt(serviceAccountSecret.requestCount, limit.max)),
      ),
    )
    .returning({ id: serviceAccountSecret.id });

  // A refused exchange writes nothing, so `last_request` stops moving while
  // the caller keeps trying. The window therefore runs out from the last
  // exchange that was allowed, and a caller that never stops is not locked
  // out for ever.
  return row !== undefined;
}

export async function insertToken(row: {
  id: string;
  serviceAccountSecretId: string;
  hash: string;
  expiresAt: Date;
}) {
  await db.insert(serviceAccountToken).values(row);
}
