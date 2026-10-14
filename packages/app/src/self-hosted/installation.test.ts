// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { verifyPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  assertInvitedUser,
  assertWorkspaceOwnershipTransferred,
  getInstallation,
  setupWorkspace,
} from "@/app/installation.server";
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
CREATE TABLE provisioning_jobs (organization_id text NOT NULL REFERENCES organization(id));
`);
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, provisioning_jobs CASCADE',
  );
});
const token = "local-setup-token-with-at-least-32-characters";
const input = {
  token,
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
  const result = await setupWorkspace(input, token, database, enqueue);
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

it.each([
  undefined,
  "wrong-token",
])("rejects an invalid setup token before writing (%s)", async (configured) => {
  await expect(
    setupWorkspace(input, configured, database, enqueue),
  ).rejects.toThrow("Invalid setup token");
  expect(await getInstallation(database)).toBeNull();
  expect(await database.select().from(schema.user)).toHaveLength(0);
});

it("allows only one of two overlapping setup attempts", async () => {
  const results = await Promise.allSettled([
    setupWorkspace(input, token, database, enqueue),
    setupWorkspace(
      { ...input, email: "other@example.test" },
      token,
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
    setupWorkspace(input, token, database, async () => {
      throw new Error("job unavailable");
    }),
  ).rejects.toThrow("job unavailable");
  expect(await getInstallation(database)).toBeNull();
  expect(await database.select().from(schema.user)).toHaveLength(0);
  await expect(
    setupWorkspace(input, token, database, enqueue),
  ).resolves.toHaveProperty("organizationId");
});

it("admits signup only for a pending, unexpired invitation in the workspace", async () => {
  const { organizationId } = await setupWorkspace(
    input,
    token,
    database,
    enqueue,
  );
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
  await setupWorkspace(input, token, database, enqueue);
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
  const { organizationId } = await setupWorkspace(
    input,
    token,
    database,
    enqueue,
  );
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
  const result = await setupWorkspace(input, token, database, enqueue);
  const originalUsers = await database.select().from(schema.user);
  await expect(
    setupWorkspace(
      { ...input, email: "another@example.test" },
      token,
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
