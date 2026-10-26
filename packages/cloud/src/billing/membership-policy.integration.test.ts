// @vitest-environment node

import type { Database } from "@everr/app/db/database";
import { account, invitation, member, organization, session, user } from "@everr/app/db/schema";
import { withTransactionReads } from "@everr/app/identity/testing/transaction-reads";
import { createApplicationAuth } from "@everr/app/identity/module";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCloudIdentityPolicy } from "../app/identity-policy";
import { beforeCreateCheckoutOrganization } from "./organization-context.server";
import { createBillingRequestLocks } from "./request-locks";
import { BillingError } from "./types";

const state = {
  beforeMembershipChange: vi.fn(),
  afterMembershipChange: vi.fn(),
  readOrgEntitlement: vi.fn(),
  beforeUserDelete: vi.fn(),
  assertDeletable: vi.fn(),
  afterOrganizationCreate: vi.fn(),
  lockQuery: vi.fn(),
  releaseLock: vi.fn(),
};

let fixture: TestDatabase;
let auth: ReturnType<typeof createApplicationAuth>;
const ownerHeaders = new Headers({
  authorization: "Bearer owner-token",
  "x-everr-send-invitation-email": "false",
});
const recipientHeaders = new Headers({
  authorization: "Bearer recipient-token",
});

function entitlement(appState: "hobby" | "suspended" | "pro") {
  state.readOrgEntitlement.mockResolvedValue({
    plan: appState === "hobby" ? "hobby" : "pro",
    appState,
    status: appState === "pro" ? "active" : null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase();
  const locks = createBillingRequestLocks({
    connect: async () =>
      ({
        query: state.lockQuery,
        release: state.releaseLock,
      }) as unknown as PoolClient,
  });
  const authDatabase = withTransactionReads(fixture.db as unknown as Database);
  auth = createApplicationAuth(
    {
      provider: {
        withIdentityRequest: locks.withBillingRequest,
        lockUserLifecycle: locks.lockUserLifecycle,
        lockAccountDeletion: locks.lockAccountDeletion,
        identityAdapter: (executor) => drizzleAdapter(executor, { provider: "pg" }),
        organizationHooks: () => ({
          beforeCreateOrganization: beforeCreateCheckoutOrganization,
          afterCreateOrganization: state.afterOrganizationCreate,
        }),
        createSessionOnboardingHook: () => async () => {},
      },
      policy: createCloudIdentityPolicy({
        billing: {
          beforeMembershipChange: state.beforeMembershipChange,
          afterMembershipChange: state.afterMembershipChange,
          beforeUserDelete: state.beforeUserDelete,
          assertDeletable: state.assertDeletable,
        },
        readOrgEntitlement: state.readOrgEntitlement,
      }),
    },
    {
      database: authDatabase,
      events: { async publish() {} },
      baseURL: "http://localhost:3000",
      secret: "cloud-membership-test-secret-long-enough",
      email: {
        enabled: true,
        sendInvitation() {},
        sendPasswordReset() {},
        sendVerification() {},
      },
      canInviteMembers: async (organizationId) =>
        (await state.readOrgEntitlement(organizationId)).appState === "pro",
    },
  );
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  vi.resetAllMocks();
  entitlement("pro");
  state.lockQuery.mockResolvedValue({ rows: [{ locked: true }] });
  const now = new Date();
  await fixture.db.insert(user).values(
    ["owner", "recipient"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await fixture.db
    .insert(organization)
    .values({ id: "org", name: "Org", slug: "org", createdAt: now });
  await fixture.db.insert(member).values({
    id: "owner-member",
    organizationId: "org",
    userId: "owner",
    role: "owner",
    createdAt: now,
  });
  await fixture.db.insert(account).values(
    ["owner", "recipient"].map((id) => ({
      id: `${id}-credential`,
      accountId: id,
      providerId: "credential",
      userId: id,
      password: "unused-credential-hash",
    })),
  );
  await fixture.db.insert(session).values(
    ["owner", "recipient"].map((id) => ({
      id: `${id}-session`,
      userId: id,
      token: `${id}-token`,
      activeOrganizationId: "org",
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: now,
      updatedAt: now,
    })),
  );
});

it.each(["hobby", "suspended", "pro"] as const)(
  "enforces %s policy through invitation creation and direct member addition",
  async (appState) => {
    entitlement(appState);
    const invite = () =>
      auth.api.createInvitation({
        headers: ownerHeaders,
        body: {
          email: "recipient@example.test",
          role: "member",
          organizationId: "org",
        },
      });
    const add = () =>
      auth.api.addMember({
        body: { organizationId: "org", userId: "recipient", role: "member" },
      });
    /* oxlint-disable vitest/no-conditional-expect -- The test table explicitly covers both outcomes, each with its own assertions. */
    if (appState === "pro") {
      await expect(invite()).resolves.toMatchObject({ status: "pending" });
      await expect(add()).resolves.toBeTruthy();
      expect(state.beforeMembershipChange).toHaveBeenCalledWith("org", "recipient", "member");
      expect(await fixture.db.select().from(invitation)).toHaveLength(1);
      expect(await fixture.db.select().from(member)).toHaveLength(2);
    } else {
      await expect(invite()).rejects.toMatchObject({
        status: "FORBIDDEN",
        message: "Invitations are unavailable for this organization.",
      });
      await expect(add()).rejects.toMatchObject({
        status: "FORBIDDEN",
        message: "Invitations are unavailable for this organization.",
      });
      expect(await fixture.db.select().from(invitation)).toHaveLength(0);
      expect(await fixture.db.select().from(member)).toHaveLength(1);
      expect(state.beforeMembershipChange).not.toHaveBeenCalled();
    }
    /* oxlint-enable vitest/no-conditional-expect */
    expect(state.readOrgEntitlement).toHaveBeenCalledWith("org");
  },
);

it.each(["hobby", "suspended", "pro"] as const)(
  "rechecks %s policy when accepting an existing invitation",
  async (appState) => {
    entitlement("pro");
    const pending = await auth.api.createInvitation({
      headers: ownerHeaders,
      body: {
        email: "recipient@example.test",
        role: "member",
        organizationId: "org",
      },
    });
    entitlement(appState);
    const accept = () =>
      auth.api.acceptInvitation({
        headers: recipientHeaders,
        body: { invitationId: pending.id },
      });
    /* oxlint-disable vitest/no-conditional-expect -- The test table explicitly covers both outcomes, each with its own assertions. */
    if (appState === "pro") {
      await expect(accept()).resolves.toBeTruthy();
      expect(state.beforeMembershipChange).toHaveBeenCalledWith("org", "recipient", "member");
    } else {
      await expect(accept()).rejects.toMatchObject({
        status: "FORBIDDEN",
        message: "Invitations are unavailable for this organization.",
      });
      expect(state.beforeMembershipChange).not.toHaveBeenCalled();
    }
    /* oxlint-enable vitest/no-conditional-expect */
    expect(await fixture.db.select().from(member)).toHaveLength(appState === "pro" ? 2 : 1);
    const [saved] = await fixture.db.select().from(invitation).where(eq(invitation.id, pending.id));
    expect(saved.status).toBe(appState === "pro" ? "accepted" : "pending");
  },
);

it("allows the initial owner of a hobby organization, then blocks additional members", async () => {
  entitlement("hobby");
  await fixture.db.delete(member);
  await expect(
    auth.api.addMember({
      body: { organizationId: "org", userId: "owner", role: "owner" },
    }),
  ).resolves.toBeTruthy();
  await expect(
    auth.api.addMember({
      body: { organizationId: "org", userId: "recipient", role: "member" },
    }),
  ).rejects.toMatchObject({ status: "FORBIDDEN" });
  const members = await fixture.db.select().from(member);
  expect(members).toHaveLength(1);
  expect(members[0]).toMatchObject({ userId: "owner", role: "owner" });
  expect(state.beforeMembershipChange).not.toHaveBeenCalled();
});

async function addRecipient(role: "admin" | "owner" = "admin") {
  await fixture.db.insert(member).values({
    id: "recipient-member",
    organizationId: "org",
    userId: "recipient",
    role,
    createdAt: new Date(),
  });
}

const mutations = {
  remove: () =>
    auth.api.removeMember({
      headers: ownerHeaders,
      body: { organizationId: "org", memberIdOrEmail: "recipient-member" },
    }),
  role: () =>
    auth.api.updateMemberRole({
      headers: ownerHeaders,
      body: {
        organizationId: "org",
        memberId: "recipient-member",
        role: "member",
      },
    }),
  leave: () =>
    auth.api.leaveOrganization({
      headers: recipientHeaders,
      body: { organizationId: "org" },
    }),
};

it.each([
  {
    mutation: "remove",
    error: new BillingError("forbidden", "Transfer billing ownership."),
    denied: true,
  },
  {
    mutation: "role",
    error: new BillingError("owner_required", "Transfer billing ownership."),
    denied: true,
  },
  {
    mutation: "leave",
    error: new BillingError("owner_required", "Transfer billing ownership."),
    denied: true,
  },
  {
    mutation: "remove",
    error: new BillingError("unavailable", "Polar unavailable"),
    denied: false,
  },
  {
    mutation: "role",
    error: new BillingError("identity_conflict", "Billing identity mismatch"),
    denied: false,
  },
  {
    mutation: "leave",
    error: new Error("Provider unavailable"),
    denied: false,
  },
] as const)(
  "preserves membership for $mutation after $error.name ($denied)",
  async ({ mutation, error, denied }) => {
    await addRecipient();
    state.beforeMembershipChange.mockRejectedValueOnce(error);
    const request = mutations[mutation]();
    /* oxlint-disable vitest/no-conditional-expect -- The test table explicitly covers both outcomes, each with its own assertions. */
    if (denied)
      await expect(request).rejects.toMatchObject({
        status: "FORBIDDEN",
        message: error.message,
      });
    else await expect(request).rejects.toBe(error);
    /* oxlint-enable vitest/no-conditional-expect */
    expect(state.beforeMembershipChange).toHaveBeenCalledWith(
      "org",
      "recipient",
      mutation === "role" ? "member" : null,
    );
    expect(
      await fixture.db.select().from(member).where(eq(member.id, "recipient-member")),
    ).toMatchObject([{ role: "admin" }]);
    expect(state.afterMembershipChange).not.toHaveBeenCalled();
  },
);

it.each(["remove", "role", "leave"] as const)(
  "reconciles application state after a successful %s",
  async (mutation) => {
    await addRecipient();
    state.afterMembershipChange.mockImplementationOnce(async (orgId) => {
      const saved = await fixture.db.select().from(member).where(eq(member.id, "recipient-member"));
      expect(orgId).toBe("org");
      expect(saved).toMatchObject(mutation === "role" ? [{ role: "member" }] : []);
    });
    await mutations[mutation]();
    expect(state.beforeMembershipChange).toHaveBeenCalledOnce();
    expect(state.afterMembershipChange).toHaveBeenCalledExactlyOnceWith("org");
  },
);

it("does not reconcile when the authentication provider rejects the last owner's departure", async () => {
  await expect(
    auth.api.leaveOrganization({
      headers: ownerHeaders,
      body: { organizationId: "org" },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  expect(await fixture.db.select().from(member)).toMatchObject([{ userId: "owner" }]);
  expect(state.afterMembershipChange).not.toHaveBeenCalled();
});

describe("account deletion", () => {
  it.each(["deletion", "creation"] as const)(
    "keeps an owner when %s starts first",
    async (first) => {
      entitlement("hobby");
      await addRecipient("owner");
      let reached!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const held = new Set<string>();
      state.lockQuery.mockImplementation(async (sql: string, [key]: string[]) => {
        if (sql.includes("pg_try_advisory_lock")) {
          if (held.has(key)) return { rows: [{ locked: false }] };
          held.add(key);
        } else held.delete(key);
        return { rows: [{ locked: true }] };
      });
      const pause = async () => {
        reached();
        await resumed;
      };
      const create = () =>
        auth.api.createOrganization({
          body: { name: "Concurrent", slug: "concurrent", userId: "recipient" },
        });
      const remove = () => auth.deleteAccount({ headers: recipientHeaders });
      if (first === "deletion") state.beforeUserDelete.mockImplementationOnce(pause);
      else state.afterOrganizationCreate.mockImplementationOnce(pause);
      const pending = first === "deletion" ? remove() : create();
      await paused;
      try {
        await expect(first === "deletion" ? create() : remove()).rejects.toThrow(
          "Please try again",
        );
      } finally {
        resume();
        await pending;
      }
      expect(held.size).toBe(0);
      expect(await fixture.db.select().from(organization)).toHaveLength(
        first === "deletion" ? 1 : 2,
      );
      /* oxlint-disable vitest/no-conditional-expect -- The test table explicitly covers both outcomes, each with its own assertions. */
      if (first === "creation") {
        await expect(remove()).rejects.toThrow("only owner");
        expect(
          await fixture.db.select().from(member).where(eq(member.userId, "recipient")),
        ).toHaveLength(2);
      } else {
        await expect(create()).rejects.toMatchObject({ status: "UNAUTHORIZED" });
        expect(await fixture.db.select().from(user).where(eq(user.id, "recipient"))).toHaveLength(
          0,
        );
      }
      /* oxlint-enable vitest/no-conditional-expect */
    },
  );

  it("rechecks the creator after locking and releases the lock when creation fails", async () => {
    state.lockQuery.mockImplementationOnce(async () => {
      // Deletion committed after Better Auth resolved the creator, before locking.
      await fixture.db.delete(user).where(eq(user.id, "recipient"));
      return { rows: [{ locked: true }] };
    });
    const response = await auth.api.createOrganization({
      body: { name: "Concurrent", slug: "concurrent", userId: "recipient" },
      asResponse: true,
    });
    expect(response.status).toBe(401);
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
    expect(state.releaseLock).toHaveBeenCalledOnce();
  });

  async function addOwnedOrganization(id: string) {
    await fixture.db.insert(organization).values({ id, name: id, slug: id, createdAt: new Date() });
    await fixture.db.insert(member).values({
      id: `${id}-owner`,
      organizationId: id,
      userId: "owner",
      role: "owner",
      createdAt: new Date(),
    });
  }

  it("names only the Pro organizations preventing account deletion", async () => {
    await addOwnedOrganization("personal");
    state.readOrgEntitlement.mockImplementation(async (id: string) => ({
      plan: id === "org" ? "pro" : "hobby",
    }));
    await expect(auth.deleteAccount({ headers: ownerHeaders })).rejects.toMatchObject({
      status: "FORBIDDEN",
      message: expect.stringContaining("Transfer ownership of: Org."),
    });
    expect(await fixture.db.select().from(user)).toHaveLength(2);
  });

  it.each(["admin", "owner"] as const)(
    "deletes an account with $0 membership while preserving the organization",
    async (role) => {
      entitlement("hobby");
      await addRecipient(role);
      await auth.deleteAccount({ headers: recipientHeaders });
      expect(await fixture.db.select().from(user).where(eq(user.id, "recipient"))).toHaveLength(0);
      expect(
        await fixture.db.select().from(member).where(eq(member.userId, "recipient")),
      ).toHaveLength(0);
      expect(await fixture.db.select().from(organization)).toHaveLength(1);
      expect(state.releaseLock).toHaveBeenCalledOnce();
    },
  );

  it("requires ownership transfer for another organization even when deleting the active one", async () => {
    entitlement("hobby");
    await addRecipient("owner");
    await addOwnedOrganization("other");
    await expect(
      auth.deleteAccount({ headers: ownerHeaders, deleteOrganization: true }),
    ).rejects.toThrow("only owner of: other");
    expect(await fixture.db.select().from(organization)).toHaveLength(2);
    expect(await fixture.db.select().from(user)).toHaveLength(2);
  });

  it("deletes the active organization before its sole owner account", async () => {
    entitlement("hobby");
    state.beforeUserDelete.mockImplementationOnce(async () => {
      expect(await fixture.db.select().from(organization)).toHaveLength(0);
      expect(state.releaseLock).not.toHaveBeenCalled();
    });
    await auth.deleteAccount({
      headers: ownerHeaders,
      deleteOrganization: true,
    });
    expect(await fixture.db.select().from(user).where(eq(user.id, "owner"))).toHaveLength(0);
    expect(state.releaseLock).toHaveBeenCalledOnce();
  });

  it("rejects unauthenticated or expired sessions before taking locks or mutating data", async () => {
    await fixture.db.update(session).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(
      auth.deleteAccount({ headers: ownerHeaders, deleteOrganization: true }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    expect(state.lockQuery).not.toHaveBeenCalled();
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
  });

  it("requires a fresh session before deleting an organization", async () => {
    entitlement("hobby");
    await fixture.db.update(session).set({ createdAt: new Date(Date.now() - 2 * 86400000) });
    await expect(
      auth.deleteAccount({ headers: ownerHeaders, deleteOrganization: true }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      message: "Sign in again before deleting your account.",
    });
    expect(await fixture.db.select().from(organization)).toHaveLength(1);
    expect(state.lockQuery).not.toHaveBeenCalled();
  });

  it.each(["admin", "missing"] as const)(
    "rejects organization deletion with $0 ownership",
    async (ownership) => {
      await addRecipient();
      if (ownership === "missing")
        await fixture.db.update(session).set({ activeOrganizationId: null });
      await expect(
        auth.deleteAccount({
          headers: recipientHeaders,
          deleteOrganization: true,
        }),
      ).rejects.toMatchObject({
        status: ownership === "missing" ? "BAD_REQUEST" : "FORBIDDEN",
      });
      expect(await fixture.db.select().from(user)).toHaveLength(2);
      expect(await fixture.db.select().from(organization)).toHaveLength(1);
    },
  );

  it.each(["organization", "user", "entitlement"] as const)(
    "preserves the cause and releases locks after a $0 failure",
    async (stage) => {
      entitlement("hobby");
      const error = new Error(`${stage} unavailable`);
      if (stage === "organization") state.assertDeletable.mockRejectedValueOnce(error);
      if (stage === "user") state.beforeUserDelete.mockRejectedValueOnce(error);
      if (stage === "entitlement") state.readOrgEntitlement.mockRejectedValueOnce(error);
      const request = auth.deleteAccount({ headers: ownerHeaders, deleteOrganization: true });
      /* oxlint-disable vitest/no-conditional-expect -- The test table explicitly covers both outcomes, each with its own assertions. */
      if (stage === "user")
        await expect(request).rejects.toMatchObject({
          message: expect.stringContaining("organization was deleted"),
          cause: error,
        });
      else await expect(request).rejects.toBe(error);
      /* oxlint-enable vitest/no-conditional-expect */
      expect(await fixture.db.select().from(organization)).toHaveLength(stage === "user" ? 0 : 1);
      expect(await fixture.db.select().from(user)).toHaveLength(2);
      expect(state.releaseLock).toHaveBeenCalledOnce();
    },
  );

  it("rechecks ownership after acquiring the cloud organization lock", async () => {
    entitlement("hobby");
    await addRecipient("owner");
    state.lockQuery.mockImplementation(async (sql: string, [key]: string[]) => {
      // Another owner's deletion committed before this request acquired the lock.
      if (sql.includes("pg_try_advisory_lock") && key === "billing:org")
        await fixture.db.delete(member).where(eq(member.id, "recipient-member"));
      return { rows: [{ locked: true }] };
    });
    await expect(auth.deleteAccount({ headers: ownerHeaders })).rejects.toThrow("only owner");
    expect(await fixture.db.select().from(user).where(eq(user.id, "owner"))).toHaveLength(1);
    expect(state.releaseLock).toHaveBeenCalledOnce();
  });
  it.each(["sole-owner", "pro-owner", "provider-failure"] as const)(
    "guards the raw deletion endpoint before removing credentials ($0)",
    async (scenario) => {
      entitlement(scenario === "pro-owner" ? "pro" : "hobby");
      if (scenario !== "sole-owner") await addRecipient("owner");
      if (scenario === "provider-failure")
        state.beforeUserDelete.mockRejectedValueOnce(new Error("Provider unavailable"));
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/delete-user", {
          method: "POST",
          headers: {
            authorization: "Bearer owner-token",
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(response.status).toBe(scenario === "provider-failure" ? 500 : 403);
      expect(await fixture.db.select().from(user).where(eq(user.id, "owner"))).toHaveLength(1);
      expect(
        await fixture.db.select().from(account).where(eq(account.userId, "owner")),
      ).toHaveLength(1);
      expect(
        await fixture.db.select().from(session).where(eq(session.userId, "owner")),
      ).toHaveLength(1);
      expect(state.releaseLock).toHaveBeenCalledOnce();
    },
  );
});
