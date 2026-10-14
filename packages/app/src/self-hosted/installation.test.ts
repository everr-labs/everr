// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { verifyPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  assertInvitedUser,
  assertWorkspaceOwnershipTransferred,
  getInstallation,
  setupWorkspace,
} from "@/app/installation.server";
import { recoverAccount } from "@/app/recovery.server";
import type { Database, DbExecutor } from "@/db/client";
import * as schema from "@/db/schema";

const client = new PGlite();
const database = drizzle(client, { schema }) as unknown as Database;
await client.exec(`
CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id), access_token text, refresh_token text, id_token text, access_token_expires_at timestamp, refresh_token_expires_at timestamp, scope text, password text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE organization (id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, logo text, metadata text, polar_customer_id text, plan text NOT NULL, created_at timestamp NOT NULL);
CREATE TABLE member (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL, created_at timestamp NOT NULL);
CREATE TABLE invitation (id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), email text NOT NULL, role text, status text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), inviter_id text NOT NULL REFERENCES "user"(id));
CREATE TABLE session (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), token text NOT NULL UNIQUE, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), ip_address text, user_agent text, active_organization_id text);
CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE provisioning_jobs (organization_id text NOT NULL REFERENCES organization(id));
`);
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, provisioning_jobs, session, verification CASCADE',
  );
});
const input = {
  workspaceName: "Acme",
  name: "Owner",
  email: "owner@example.test",
  password: "long-test-password",
};
const enqueue = vi.fn(
  async (organizationId: string, tx: DbExecutor = database) => {
    const { sql } = await import("drizzle-orm");
    await tx.execute(
      sql`INSERT INTO provisioning_jobs (organization_id) VALUES (${organizationId})`,
    );
  },
);

it("creates an owner, usable password and provisioning job together", async () => {
  expect(await getInstallation(database)).toBeNull();
  const result = await setupWorkspace(input, database, enqueue);
  expect(await getInstallation(database)).toEqual({
    id: result.organizationId,
  });
  const [owner] = await database.select().from(schema.user);
  const [credential] = await database.select().from(schema.account);
  if (!credential.password) throw new Error("Missing owner credential");
  expect(
    await verifyPassword({
      password: input.password,
      hash: credential.password,
    }),
  ).toBe(true);
  expect(credential).toMatchObject({
    userId: owner.id,
    accountId: owner.id,
    providerId: "credential",
  });
  expect(await database.select().from(schema.member)).toEqual([
    expect.objectContaining({
      organizationId: result.organizationId,
      userId: owner.id,
      role: "owner",
    }),
  ]);
  expect(
    (await client.query("SELECT * FROM provisioning_jobs")).rows,
  ).toHaveLength(1);
});

it("allows only one of two overlapping setup attempts", async () => {
  const results = await Promise.allSettled([
    setupWorkspace(input, database, enqueue),
    setupWorkspace(
      { ...input, email: "other@example.test" },
      database,
      enqueue,
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(await database.select().from(schema.organization)).toHaveLength(1);
  expect(await database.select().from(schema.user)).toHaveLength(1);
});

it("rolls back the whole setup if provisioning cannot be queued, allowing retry", async () => {
  await expect(
    setupWorkspace(input, database, async () => {
      throw new Error("job unavailable");
    }),
  ).rejects.toThrow("job unavailable");
  expect(await getInstallation(database)).toBeNull();
  expect(await database.select().from(schema.user)).toHaveLength(0);
  await expect(
    setupWorkspace(input, database, enqueue),
  ).resolves.toHaveProperty("organizationId");
});

it("admits signup only for a pending, unexpired invitation in the workspace", async () => {
  const { organizationId } = await setupWorkspace(input, database, enqueue);
  const [owner] = await database.select().from(schema.user);
  await database.insert(schema.invitation).values({
    id: "invite",
    organizationId,
    inviterId: owner.id,
    email: "Teammate@example.test",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await expect(
    assertInvitedUser("teammate@example.test", database),
  ).resolves.toBeUndefined();
  await expect(
    assertInvitedUser("stranger@example.test", database),
  ).rejects.toThrow("invitation");
  await client.exec(
    "UPDATE invitation SET expires_at = now() - interval '1 second'",
  );
  await expect(
    assertInvitedUser("teammate@example.test", database),
  ).rejects.toThrow("invitation");
});

it("does not silently choose a workspace in an existing multi-organization database", async () => {
  await setupWorkspace(input, database, enqueue);
  await database.insert(schema.organization).values({
    id: "other",
    name: "Other",
    slug: "other",
    plan: "self-hosted",
    createdAt: new Date(),
  });
  await expect(getInstallation(database)).rejects.toThrow(
    "multiple organizations",
  );
});

it("requires ownership transfer before the last owner can delete their account", async () => {
  const { organizationId } = await setupWorkspace(input, database, enqueue);
  const [owner] = await database.select().from(schema.user);
  await expect(
    assertWorkspaceOwnershipTransferred(owner.id, database),
  ).rejects.toThrow("Transfer workspace ownership");
  await database.insert(schema.user).values({
    id: "next-owner",
    name: "Next owner",
    email: "next@example.test",
  });
  await database.insert(schema.member).values({
    id: "next-membership",
    userId: "next-owner",
    organizationId,
    role: "owner",
    createdAt: new Date(),
  });
  await expect(
    assertWorkspaceOwnershipTransferred(owner.id, database),
  ).resolves.toBeUndefined();
});

it("rejects replay after a committed setup without changing the workspace or owner", async () => {
  const result = await setupWorkspace(input, database, enqueue);
  const originalUsers = await database.select().from(schema.user);
  await expect(
    setupWorkspace(
      { ...input, email: "another@example.test" },
      database,
      enqueue,
    ),
  ).rejects.toThrow("already configured");
  expect(await getInstallation(database)).toEqual({
    id: result.organizationId,
  });
  expect(await database.select().from(schema.user)).toEqual(originalUsers);
  expect(await database.select().from(schema.account)).toHaveLength(1);
  expect(await database.select().from(schema.member)).toHaveLength(1);
  expect(
    (await client.query("SELECT * FROM provisioning_jobs")).rows,
  ).toHaveLength(1);
});

it("recovers a local password without changing identity and invalidates sessions and reset links", async () => {
  await setupWorkspace(input, database, enqueue);
  const [owner] = await database.select().from(schema.user);
  await database.insert(schema.session).values({
    id: "old-session",
    userId: owner.id,
    token: "old-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const link = await recoverAccount(database, input.email, {
    kind: "link",
    baseUrl: "https://everr.example",
  });
  expect(link.kind).toBe("link");
  await recoverAccount(database, input.email.toUpperCase(), {
    kind: "password",
    password: "replacement-password",
  });
  const [credential] = await database.select().from(schema.account);
  expect(
    await verifyPassword({
      hash: credential.password ?? "",
      password: "replacement-password",
    }),
  ).toBe(true);
  expect(await database.select().from(schema.session)).toEqual([]);
  expect(await database.select().from(schema.verification)).toEqual([]);
  expect((await database.select().from(schema.user))[0]).toEqual(owner);
  expect((await database.select().from(schema.member))[0].role).toBe("owner");
});

it("issues expiring links consumable once by Better Auth and replaces previous links", async () => {
  await setupWorkspace(input, database, enqueue);
  const auth = betterAuth({
    baseURL: "https://everr.example",
    secret: "recovery-test-secret-at-least-32-characters",
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true },
  });
  const first = await recoverAccount(database, input.email, {
    kind: "link",
    baseUrl: "https://everr.example",
  });
  const second = await recoverAccount(database, input.email, {
    kind: "link",
    baseUrl: "https://everr.example",
  });
  if (first.kind !== "link" || second.kind !== "link")
    throw new Error("Expected links");
  expect(second.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  expect(second.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
    15 * 60_000,
  );
  const reset = (url: string) =>
    auth.api.resetPassword({
      body: {
        token: new URL(url).searchParams.get("token") ?? "",
        newPassword: "reset-through-auth",
      },
    });
  await expect(reset(first.url)).rejects.toThrow();
  const [owner] = await database.select().from(schema.user);
  await database.insert(schema.session).values({
    id: "new-session",
    userId: owner.id,
    token: "new-session-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await expect(reset(second.url)).resolves.toEqual({ status: true });
  await expect(reset(second.url)).rejects.toThrow();
  expect(await database.select().from(schema.session)).toEqual([]);
  expect((await database.select().from(schema.user))[0].emailVerified).toBe(
    false,
  );
  const expired = await recoverAccount(database, input.email, {
    kind: "link",
    baseUrl: "https://everr.example",
  });
  if (expired.kind !== "link") throw new Error("Expected link");
  await database.update(schema.verification).set({ expiresAt: new Date(0) });
  await expect(reset(expired.url)).rejects.toThrow();
});

it("refuses recovery for missing or external-only accounts without creating credentials", async () => {
  await expect(
    recoverAccount(database, input.email, {
      kind: "password",
      password: "replacement-password",
    }),
  ).rejects.toThrow("No account");
  await setupWorkspace(input, database, enqueue);
  await database
    .update(schema.account)
    .set({ providerId: "google", password: null });
  await expect(
    recoverAccount(database, input.email, {
      kind: "link",
      baseUrl: "https://everr.example",
    }),
  ).rejects.toThrow("no local password");
  expect(await database.select().from(schema.verification)).toEqual([]);
  expect((await database.select().from(schema.account))[0].password).toBeNull();
});
