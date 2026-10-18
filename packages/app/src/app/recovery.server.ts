import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "#app/db/client.ts";
import { account, session, user, verification } from "#app/db/schema/auth.ts";

export type RecoveryAction =
  | { kind: "link"; baseUrl: string }
  | { kind: "password"; password: string };

// Keep token format compatible with Better Auth's reset-password endpoint.
export async function recoverAccount(
  database: Database,
  email: string,
  action: RecoveryAction,
) {
  const address = z.email().parse(email.trim().toLowerCase());
  let prepared:
    | { kind: "password"; passwordHash: string }
    | { kind: "link"; url: URL };
  if (action.kind === "password") {
    prepared = {
      kind: "password",
      passwordHash: await hashPassword(
        z.string().min(8).max(128).parse(action.password),
      ),
    };
  } else {
    const url = new URL("/auth/reset-password", action.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "BETTER_AUTH_URL must be an HTTP(S) URL without credentials.",
      );
    }
    prepared = { kind: "link", url };
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
    if (prepared.kind === "password") {
      await tx
        .update(account)
        .set({ password: prepared.passwordHash })
        .where(eq(account.id, credential.id));
      return { kind: "password" as const };
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: `reset-password:${token}`,
      value: target.id,
      expiresAt,
    });
    prepared.url.searchParams.set("token", token);
    return { kind: "link" as const, url: prepared.url.toString(), expiresAt };
  });
}
