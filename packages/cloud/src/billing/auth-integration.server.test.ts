// @vitest-environment node
import { createApplicationAuth } from "@everr/app/identity/module";
import { createAuthTestDatabase } from "@everr/app/identity/testing/database";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { type MemoryDB, memoryAdapter } from "better-auth/adapters/memory";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  beforeUserUpdate: vi.fn(),
  afterUserUpdate: vi.fn(),
  beforeMembershipChange: vi.fn(),
  afterMembershipChange: vi.fn(),
}));
vi.mock("./server", () => ({ billing: mocks }));
vi.mock("./lock.server", () => ({
  withBillingRequest: (run: () => Promise<unknown>) => run(),
}));

import { billingIdentityAdapter } from "./auth-adapter.server";

it("uses the actual update target for authenticated profile and anonymous verified-email changes", async () => {
  vi.clearAllMocks();
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let verificationUrl = "";
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "billing-auth-integration-secret-long-enough",
    database: billingIdentityAdapter(memoryAdapter(db)),
    emailAndPassword: { enabled: true },
    user: { changeEmail: { enabled: true } },
    emailVerification: {
      sendVerificationEmail: async ({ url }) => {
        verificationUrl = url;
      },
    },
  });
  const response = await auth.api.signUpEmail({
    body: {
      email: "old@example.com",
      name: "Owner",
      password: "password-12345",
    },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: response.headers.get("set-cookie") ?? "",
  });
  const owner = db.user[0];
  owner.emailVerified = true;
  await auth.api.updateUser({ headers, body: { name: "Renamed" } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ name: "Renamed" }),
  );
  await auth.api.changeEmail({
    headers,
    body: { newEmail: "new@example.com" },
  });
  const token = new URL(verificationUrl).searchParams.get("token");
  if (!token) throw new Error("Verification token missing");
  mocks.beforeUserUpdate.mockClear();
  await auth.api.verifyEmail({ query: { token } });
  expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ email: "new@example.com", emailVerified: true }),
  );
  expect(mocks.afterUserUpdate).toHaveBeenCalledWith(
    owner.id,
    expect.objectContaining({ email: "new@example.com", emailVerified: true }),
  );
  expect(db.user[0].email).toBe("new@example.com");
});

it("preserves billing checks inside nested source transactions and holds request scope through commit", async () => {
  vi.clearAllMocks();
  const { client, database } = await createAuthTestDatabase();
  let active = false;
  const facts: string[] = [];
  const auth = createApplicationAuth(
    {
      policy: {
        beforeUserCreate: async () => {},
        beforeUserDelete: async () => {},
        beforeMembershipChange: async () => {},
        afterMembershipChange: async () => {},
        assertAccountDeletionAllowed: async () => {},
        assertDeletable: async () => {},
      },
      provider: {
        withIdentityRequest: async (run) => {
          if (active) return run();
          active = true;
          try {
            return await run();
          } finally {
            active = false;
          }
        },
        lockUserLifecycle: async () => {
          expect(active).toBe(true);
        },
        lockAccountDeletion: async () => {},
        identityAdapter: (executor) =>
          billingIdentityAdapter(drizzleAdapter(executor, { provider: "pg" })),
        organizationHooks: () => ({}),
        createSessionOnboardingHook: () => async () => {},
      },
    },
    {
      database,
      baseURL: "http://localhost:3000",
      secret: "nested-billing-identity-secret-long-enough",
      events: {
        publish: async (fact) => {
          expect(active).toBe(true);
          facts.push(fact.type);
        },
      },
      email: { enabled: false, sendInvitation() {}, sendPasswordReset() {}, sendVerification() {} },
      canInviteMembers: async () => true,
    },
  );
  try {
    const signup = await auth.api.signUpEmail({
      body: { name: "Before", email: "nested@example.test", password: "nested-test-password" },
    });
    facts.length = 0;
    const { adapter } = await auth.$context;
    await adapter.transaction(async (outer) => {
      await (outer as typeof adapter).transaction(async (inner) => {
        await inner.update({
          model: "user",
          where: [{ field: "id", value: signup.user.id }],
          update: { name: "After" },
        });
        expect(facts).toEqual([]);
        expect(mocks.beforeUserUpdate).toHaveBeenCalledWith(signup.user.id, { name: "After" });
        expect(mocks.afterUserUpdate).toHaveBeenCalledWith(signup.user.id, { name: "After" });
      });
      expect(active).toBe(true);
      expect(facts).toEqual([]);
    });
    expect(active).toBe(false);
    expect(facts).toEqual(["identity.user.updated"]);
    expect((await client.query('SELECT name FROM "user"')).rows).toEqual([{ name: "After" }]);
    facts.length = 0;
    mocks.beforeUserUpdate.mockRejectedValueOnce(new Error("billing validation rejected"));
    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: signup.user.id }],
        update: { name: "Rejected" },
      }),
    ).rejects.toThrow("billing validation rejected");
    expect(facts).toEqual([]);
    expect(active).toBe(false);
    expect((await client.query('SELECT name FROM "user"')).rows).toEqual([{ name: "After" }]);
  } finally {
    await client.close();
  }
});
