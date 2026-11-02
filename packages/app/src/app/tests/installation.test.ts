// @vitest-environment node
import { createEventPublisher } from "#app/server/events/publisher.ts";
import {
  userEventDefinitions,
  organizationEventDefinitions,
  membershipEventDefinitions,
  membershipChanged,
  organizationChanged,
  type UserEvent,
} from "#app/identity/events.ts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { createInstallationIdentityPolicy } from "#app/app/identity-policy.ts";
import {
  assertInvitedUser,
  getInstallation,
  setupWorkspace,
} from "#app/app/installation.server.ts";
import { createRecoveryLink } from "#app/app/recovery.server.ts";
import * as schema from "#app/db/schema/index.ts";
import { createAuthTestDatabase } from "#app/identity/testing/database.ts";

const { client, database } = await createAuthTestDatabase();
afterAll(() => client.close());
beforeEach(async () => {
  await client.exec(
    'TRUNCATE "user", account, organization, member, invitation, session, verification CASCADE',
  );
});
const input = {
  workspaceName: "Acme",
  name: "Owner",
  email: "owner@example.test",
  password: "long-test-password",
};
it("creates an owner with a usable password", async () => {
  expect(await getInstallation(database)).toBeNull();
  const publish = vi.fn();
  const result = await setupWorkspace(input, database, { publish });
  expect(await getInstallation(database)).toEqual({
    id: result.organizationId,
  });
  const [owner] = await database.select().from(schema.user);
  expect(publish).toHaveBeenCalledWith({
    type: "identity.user.created",
    version: 1,
    subjectId: owner.id,
    data: { userId: owner.id, emailVerified: false },
  } satisfies UserEvent);
  const [initialMembership] = await database.select().from(schema.member);
  expect(publish.mock.calls.map(([fact]) => fact)).toEqual([
    expect.objectContaining({ type: "identity.user.created" }),
    organizationChanged("organization.created", result.organizationId),
    membershipChanged("membership.added", initialMembership),
  ]);
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
});

it("allows only one of two overlapping setup attempts", async () => {
  const results = await Promise.allSettled([
    setupWorkspace(input, database),
    setupWorkspace({ ...input, email: "other@example.test" }, database),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await database.select().from(schema.organization)).toHaveLength(1);
  expect(await database.select().from(schema.user)).toHaveLength(1);
});

it("rolls back the whole setup after a database constraint failure, allowing retry", async () => {
  await client.exec(
    "ALTER TABLE member ADD CONSTRAINT reject_initial_owner CHECK (role <> 'owner')",
  );
  const publish = vi.fn();
  await expect(setupWorkspace(input, database, { publish })).rejects.toThrow();
  expect(publish).not.toHaveBeenCalled();
  expect(await getInstallation(database)).toBeNull();
  expect(await database.select().from(schema.user)).toHaveLength(0);
  expect(await database.select().from(schema.account)).toHaveLength(0);
  await client.exec("ALTER TABLE member DROP CONSTRAINT reject_initial_owner");
  await expect(setupWorkspace(input, database)).resolves.toHaveProperty("organizationId");
});

it("admits signup only for a pending, unexpired invitation in the workspace", async () => {
  const { organizationId } = await setupWorkspace(input, database);
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
    assertInvitedUser({ email: "teammate@example.test" }, "invite", database),
  ).resolves.toBeUndefined();
  await expect(
    assertInvitedUser({ email: "teammate@example.test", emailVerified: true }, undefined, database),
  ).resolves.toBeUndefined();
  await expect(
    assertInvitedUser({ email: "stranger@example.test" }, "invite", database),
  ).rejects.toThrow("invitation");
  await client.exec("UPDATE invitation SET expires_at = timestamp '2000-01-01 00:00:00'");
  await expect(
    assertInvitedUser({ email: "teammate@example.test" }, "invite", database),
  ).rejects.toThrow("invitation");
});

it("does not silently choose a workspace in an existing multi-organization database", async () => {
  await setupWorkspace(input, database);
  await database.insert(schema.organization).values({
    id: "other",
    name: "Other",
    slug: "other",
    createdAt: new Date(),
  });
  await expect(getInstallation(database)).rejects.toThrow("multiple organizations");
});

it("rejects replay after a committed setup without changing the workspace or owner", async () => {
  const result = await setupWorkspace(input, database);
  const originalUsers = await database.select().from(schema.user);
  await expect(
    setupWorkspace({ ...input, email: "another@example.test" }, database),
  ).rejects.toThrow("already configured");
  expect(await getInstallation(database)).toEqual({
    id: result.organizationId,
  });
  expect(await database.select().from(schema.user)).toEqual(originalUsers);
  expect(await database.select().from(schema.account)).toHaveLength(1);
  expect(await database.select().from(schema.member)).toHaveLength(1);
});

it("issues a recovery link without changing credentials or identity and invalidates sessions and old links", async () => {
  await setupWorkspace(input, database);
  const [owner] = await database.select().from(schema.user);
  const credentials = await database.select().from(schema.account);
  await database.insert(schema.session).values({
    id: "old-session",
    userId: owner.id,
    token: "old-token",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await createRecoveryLink(database, input.email, "https://everr.example");
  const link = await createRecoveryLink(
    database,
    input.email.toUpperCase(),
    "https://everr.example",
  );
  expect(await database.select().from(schema.account)).toEqual(credentials);
  expect(await database.select().from(schema.session)).toEqual([]);
  expect(await database.select().from(schema.verification)).toEqual([
    expect.objectContaining({
      identifier: `reset-password:${new URL(link.url).searchParams.get("token")}`,
      value: owner.id,
    }),
  ]);
  expect((await database.select().from(schema.user))[0]).toEqual(owner);
  expect((await database.select().from(schema.member))[0].role).toBe("owner");
});

it("issues expiring links consumable once by Better Auth and replaces previous links", async () => {
  await setupWorkspace(input, database);
  const auth = betterAuth({
    baseURL: "https://everr.example",
    secret: "recovery-test-secret-at-least-32-characters",
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, revokeSessionsOnPasswordReset: true },
  });
  const first = await createRecoveryLink(database, input.email, "https://everr.example");
  const second = await createRecoveryLink(database, input.email, "https://everr.example");
  expect(second.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  expect(second.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
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
  expect((await database.select().from(schema.user))[0].emailVerified).toBe(false);
  const expired = await createRecoveryLink(database, input.email, "https://everr.example");
  await database.update(schema.verification).set({ expiresAt: new Date(0) });
  await expect(reset(expired.url)).rejects.toThrow();
});

it("refuses recovery for missing or external-only accounts without creating credentials", async () => {
  await expect(createRecoveryLink(database, input.email, "https://everr.example")).rejects.toThrow(
    "No account",
  );
  await setupWorkspace(input, database);
  await database.update(schema.account).set({ providerId: "google", password: null });
  await expect(createRecoveryLink(database, input.email, "https://everr.example")).rejects.toThrow(
    "no local password",
  );
  expect(await database.select().from(schema.verification)).toEqual([]);
  expect((await database.select().from(schema.account))[0].password).toBeNull();
});

it("preserves database failures in installation identity policy", async () => {
  const policy = createInstallationIdentityPolicy(database);
  const failure = new Error("database connection lost");
  const select = vi.spyOn(database, "select").mockImplementation(() => {
    throw failure;
  });
  try {
    await expect(policy.beforeUserCreate({ email: "invited@example.test" }, "invite")).rejects.toBe(
      failure,
    );
  } finally {
    select.mockRestore();
  }
});

it.each(["throw", "reject"])(
  "preserves committed setup when Graphile admission fails (%s)",
  async (failure) => {
    const enqueue = vi.fn(() => {
      if (failure === "throw") throw new Error("Graphile unavailable");
      return Promise.reject(new Error("Graphile unavailable"));
    });
    const publisher = createEventPublisher({
      routes: [
        ...userEventDefinitions,
        ...organizationEventDefinitions,
        ...membershipEventDefinitions,
      ].map((definition) => ({
        definition,
        job: (event) => ({ task: "test/installation", payload: event }),
      })),
      enqueue,
    });
    const publish = vi.fn(publisher.publish);
    const result = await setupWorkspace(input, database, { publish });
    expect((await database.select().from(schema.organization))[0].id).toBe(result.organizationId);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
  },
);
