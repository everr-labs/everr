import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "#app/db/client.ts";
import { account, session, user, verification } from "#app/db/schema/auth.ts";

// Keep token format compatible with Better Auth's reset-password endpoint.
export async function createRecoveryLink(
  database: Database,
  email: string,
  baseUrl: string,
) {
  const address = z.email().parse(email.trim().toLowerCase());
  const url = new URL("/auth/reset-password", baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an HTTP(S) URL without credentials.",
    );
  }

  return database.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(user)
      .where(eq(sql`lower(${user.email})`, address))
      .for("update");
    if (!target) throw new Error("No account exists with that email address.");
    const [credential] = await tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, target.id),
          eq(account.providerId, "credential"),
        ),
      );
    if (!credential)
      throw new Error(
        "This account has no local password. Recover it through its identity provider.",
      );

    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, target.id),
          like(verification.identifier, "reset-password:%"),
        ),
      );
    await tx.delete(session).where(eq(session.userId, target.id));
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: `reset-password:${token}`,
      value: target.id,
      expiresAt,
    });
    url.searchParams.set("token", token);
    return { url: url.toString(), expiresAt };
  });
}
