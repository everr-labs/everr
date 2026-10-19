// @vitest-environment node
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
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

const state = vi.hoisted(() => ({
  database: undefined as unknown,
  beforeMembershipChange: vi.fn(),
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
vi.mock("../app/auth", async () => ({
  identity: {
    ...(await import("../app/onboarding")),
    withIdentityRequest: (await import("./lock.server")).withBillingRequest,
    identityAdapter: () =>
      drizzleAdapter(state.database as Parameters<typeof drizzleAdapter>[0], {
        provider: "pg",
      }),
    organizationHooks: () => ({}),
    identityLifecycle: { beforeMembershipChange: state.beforeMembershipChange },
    authPlugins: () => [],
    membershipPlugin: { id: "membership-policy-fixture" },
  },
}));
vi.unmock("@everr/app/lib/auth.server");

import { readOrgEntitlement } from "../billing-data.server";
let fixture: TestDatabase;
let auth: typeof import("@everr/app/lib/auth.server").auth;
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
  ({ auth } = await import("@everr/app/lib/auth.server"));
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  vi.clearAllMocks();
  const now = new Date();
  await fixture.db
    .insert(user)
    .values(
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
  await fixture.db
    .insert(member)
    .values({
      id: "owner-member",
      organizationId: "org",
      userId: "owner",
      role: "owner",
      createdAt: now,
    });
  await fixture.db
    .insert(session)
    .values(
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
