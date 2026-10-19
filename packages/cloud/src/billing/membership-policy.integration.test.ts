// @vitest-environment node

import {
  invitation,
  member,
  organization,
  session,
  user,
} from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: undefined as unknown,
  beforeMembershipChange: vi.fn(),
  afterMembershipChange: vi.fn(),
}));
vi.mock("@everr/app/db/client", () => ({
  get db() {
    return state.database;
  },
  pool: { options: {} },
}));
vi.mock("../billing-data.server", () => ({ readOrgEntitlement: vi.fn() }));
// Keep the production auth configuration and policy hooks. Isolate billing and
// provisioning side effects, which have their own integration suites.
vi.mock("../app/composition/identity", async () => ({
  identity: {
    provider: {
      ...(await import("../app/onboarding")),
      withIdentityRequest: (await import("./lock.server")).withBillingRequest,
      identityAdapter: () =>
        drizzleAdapter(state.database as Parameters<typeof drizzleAdapter>[0], {
          provider: "pg",
        }),
      organizationHooks: () => ({}),
      authPlugins: () => [],
    },
    policy: {
      async beforeUserCreate() {},
      async assertAccountDeletionAllowed() {},
      beforeMembershipChange: state.beforeMembershipChange,
      afterMembershipChange: state.afterMembershipChange,
      async beforeUserDelete() {},
      async assertDeletable() {},
    },
  },
}));
vi.unmock("@everr/app/identity/server");

import { readOrgEntitlement } from "../billing-data.server";

let fixture: TestDatabase;
let auth: typeof import("@everr/app/identity/server").auth;
const ownerHeaders = new Headers({
  authorization: "Bearer owner-token",
  "x-everr-send-invitation-email": "false",
});
const recipientHeaders = new Headers({
  authorization: "Bearer recipient-token",
});

function entitlement(appState: "hobby" | "suspended" | "pro") {
  vi.mocked(readOrgEntitlement).mockResolvedValue({
    plan: appState === "hobby" ? "hobby" : "pro",
    appState,
    status: appState === "pro" ? "active" : null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
}

beforeAll(async () => {
  fixture = await createTestDatabase();
  state.database = fixture.db;
  ({ auth } = await import("@everr/app/identity/server"));
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  vi.clearAllMocks();
  state.beforeMembershipChange.mockReset();
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
  await fixture.db.insert(session).values(
    ["owner", "recipient"].map((id) => ({
      id: `${id}-session`,
      userId: id,
      token: `${id}-token`,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: now,
      updatedAt: now,
    })),
  );
});

it.each([
  "hobby",
  "suspended",
  "pro",
] as const)("enforces %s policy through invitation creation and direct member addition", async (appState) => {
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
  if (appState === "pro") {
    await expect(invite()).resolves.toMatchObject({ status: "pending" });
    await expect(add()).resolves.toBeTruthy();
    expect(state.beforeMembershipChange).toHaveBeenCalledWith(
      "org",
      "recipient",
      "member",
    );
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
  expect(readOrgEntitlement).toHaveBeenCalledWith("org");
});

it.each([
  "hobby",
  "suspended",
  "pro",
] as const)("rechecks %s policy when accepting an existing invitation", async (appState) => {
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
  if (appState === "pro") {
    await expect(accept()).resolves.toBeTruthy();
    expect(state.beforeMembershipChange).toHaveBeenCalledWith(
      "org",
      "recipient",
      "member",
    );
  } else {
    await expect(accept()).rejects.toMatchObject({
      status: "FORBIDDEN",
      message: "Invitations are unavailable for this organization.",
    });
    expect(state.beforeMembershipChange).not.toHaveBeenCalled();
  }
  expect(await fixture.db.select().from(member)).toHaveLength(
    appState === "pro" ? 2 : 1,
  );
  const [saved] = await fixture.db
    .select()
    .from(invitation)
    .where(eq(invitation.id, pending.id));
  expect(saved.status).toBe(appState === "pro" ? "accepted" : "pending");
});

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

async function addRecipient() {
  await fixture.db.insert(member).values({
    id: "recipient-member",
    organizationId: "org",
    userId: "recipient",
    role: "admin",
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
  "remove",
  "role",
  "leave",
] as const)("preserves membership when %s is denied by application policy", async (mutation) => {
  await addRecipient();
  state.beforeMembershipChange.mockRejectedValueOnce(
    new Error("Polar unavailable"),
  );
  await expect(mutations[mutation]()).rejects.toThrow("Polar unavailable");
  expect(state.beforeMembershipChange).toHaveBeenCalledWith(
    "org",
    "recipient",
    mutation === "role" ? "member" : null,
  );
  expect(
    await fixture.db
      .select()
      .from(member)
      .where(eq(member.id, "recipient-member")),
  ).toMatchObject([{ role: "admin" }]);
  expect(state.afterMembershipChange).not.toHaveBeenCalled();
});

it.each([
  "remove",
  "role",
  "leave",
] as const)("reconciles application state after a successful %s", async (mutation) => {
  await addRecipient();
  state.afterMembershipChange.mockImplementationOnce(async (orgId) => {
    const saved = await fixture.db
      .select()
      .from(member)
      .where(eq(member.id, "recipient-member"));
    expect(orgId).toBe("org");
    expect(saved).toMatchObject(
      mutation === "role" ? [{ role: "member" }] : [],
    );
  });
  await mutations[mutation]();
  expect(state.beforeMembershipChange).toHaveBeenCalledOnce();
  expect(state.afterMembershipChange).toHaveBeenCalledExactlyOnceWith("org");
});

it("does not reconcile when the authentication provider rejects the last owner's departure", async () => {
  await expect(
    auth.api.leaveOrganization({
      headers: ownerHeaders,
      body: { organizationId: "org" },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  expect(await fixture.db.select().from(member)).toMatchObject([
    { userId: "owner" },
  ]);
  expect(state.afterMembershipChange).not.toHaveBeenCalled();
});
