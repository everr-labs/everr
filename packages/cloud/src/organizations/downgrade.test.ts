// @vitest-environment node
import { createEventPublisher } from "@everr/app/server/events/publisher";
import { membershipEventDefinitions } from "@everr/app/identity/events";
import { billingEventDefinitions } from "../billing/events";
import { invitation, member, organization, user } from "@everr/app/db/schema";
import {
  createTestDatabase,
  type TestDatabase,
} from "@everr/app/server/alerting/testing/pglite-database";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { organizationBilling } from "../db/schema";
import { cloudTestMigrations } from "../testing/migrations";
import { organizationCommands } from "./commands.server";

let fixture: TestDatabase;
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  afterCommit: vi.fn(),
  lockOwnership: vi.fn(),
  entitlement: vi.fn(),
  ownsHobby: vi.fn(),
  revoke: vi.fn(),
  beforeBillingLock: vi.fn(),
  afterOwnershipLock: vi.fn(),
}));
vi.mock("@everr/app/server/events/runtime", () => ({
  events: { publish: mocks.publish },
}));
vi.mock("@everr/app/identity/server", () => ({ auth: { api: {} } }));
vi.mock("@everr/app/db/client", () => ({
  get db() {
    return fixture.db;
  },
}));
vi.mock("../billing-data.server", () => ({
  readOrgEntitlement: mocks.entitlement,
  userOwnsHobbyOrganization: mocks.ownsHobby,
}));
vi.mock("../organization-lock.server", () => ({
  lockOrganizationOwnership: mocks.lockOwnership,
}));
vi.mock("../billing/server", () => ({
  billing: {
    downgrade: async (
      _orgId: string,
      _userId: string,
      commit: (revoke: () => Promise<void>) => Promise<unknown>,
    ) => {
      await mocks.beforeBillingLock();
      const result = await commit(mocks.revoke);
      await mocks.afterCommit();
      return result;
    },
  },
}));

beforeAll(async () => {
  fixture = await createTestDatabase(cloudTestMigrations);
});
afterAll(async () => fixture?.close());
beforeEach(async () => {
  await fixture.truncate();
  vi.resetAllMocks();
  mocks.entitlement.mockResolvedValue({ appState: "suspended" });
  mocks.ownsHobby.mockResolvedValue(false);
  mocks.lockOwnership.mockImplementation(async () => mocks.afterOwnershipLock());
  await fixture.db.insert(user).values(
    ["owner-a", "owner-b"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
    })),
  );
  await fixture.db.insert(organization).values(
    ["org", "other"].map((id) => ({
      id,
      name: id,
      slug: id,
      createdAt: new Date(),
    })),
  );
  await fixture.db.insert(organizationBilling).values({ orgId: "org", plan: "pro" });
  await fixture.db.insert(member).values([
    {
      id: "owner-a",
      organizationId: "org",
      userId: "owner-a",
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: "owner-b",
      organizationId: "org",
      userId: "owner-b",
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: "other-owner",
      organizationId: "other",
      userId: "owner-b",
      role: "owner",
      createdAt: new Date(),
    },
  ]);
  await fixture.db.insert(invitation).values(
    [
      { id: "pending", organizationId: "org", status: "pending" },
      { id: "accepted", organizationId: "org", status: "accepted" },
      { id: "other", organizationId: "other", status: "pending" },
    ].map((row) => ({
      ...row,
      email: "invitee@example.test",
      inviterId: "owner-a",
      expiresAt: new Date(Date.now() + 60000),
    })),
  );
});

const downgrade = (actorId = "owner-a") =>
  organizationCommands.downgradeToHobby({ organizationId: "org", actorId });
async function savedState() {
  return {
    members: (await fixture.db.select({ id: member.id }).from(member)).map(({ id }) => id).sort(),
    invitations: await fixture.db
      .select({ id: invitation.id, status: invitation.status })
      .from(invitation)
      .orderBy(invitation.id),
    plan: (await fixture.db.select().from(organizationBilling))[0].plan,
  };
}

it("downgrades atomically, retaining its Owner and leaving other organizations and accepted invitations untouched", async () => {
  await expect(downgrade()).resolves.toEqual({
    removedMembers: 1,
    canceledInvitations: 1,
  });
  expect(await savedState()).toEqual({
    members: ["other-owner", "owner-a"],
    plan: "hobby",
    invitations: [
      { id: "accepted", status: "accepted" },
      { id: "other", status: "pending" },
      { id: "pending", status: "canceled" },
    ],
  });
  expect(mocks.revoke).toHaveBeenCalledOnce();
});

it.each(["billing", "ownership"] as const)(
  "rechecks suspension after acquiring the %s lock",
  async (lock) => {
    const before = await savedState();
    const hook = lock === "billing" ? mocks.beforeBillingLock : mocks.afterOwnershipLock;
    hook.mockImplementationOnce(() => {
      mocks.entitlement.mockResolvedValue({ appState: "pro" });
    });
    await expect(downgrade()).rejects.toThrow("Only a suspended Pro");
    expect(await savedState()).toEqual(before);
    expect(mocks.revoke).not.toHaveBeenCalled();
  },
);

it("preserves collaboration when the owner already owns another Hobby organization", async () => {
  const before = await savedState();
  mocks.ownsHobby.mockResolvedValue(true);
  await expect(downgrade()).rejects.toThrow("already own a Hobby");
  expect(await savedState()).toEqual(before);
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it.each(["provider", "database"] as const)(
  "preserves members, invitations, and plan after a %s failure",
  async (failure) => {
    const before = await savedState();
    if (failure === "provider")
      mocks.revoke.mockRejectedValueOnce(new Error("Provider unavailable"));
    else
      await fixture.client.exec(
        "ALTER TABLE organization_billing ADD CONSTRAINT reject_downgrade CHECK (plan <> 'hobby')",
      );
    try {
      await expect(downgrade()).rejects.toThrow();
      expect(await savedState()).toEqual(before);
      expect(mocks.publish).not.toHaveBeenCalled();
    } finally {
      if (failure === "database")
        await fixture.client.exec(
          "ALTER TABLE organization_billing DROP CONSTRAINT reject_downgrade",
        );
    }
  },
);

it.each(["missing", "admin"] as const)(
  "rejects a retained member with %s ownership",
  async (ownership) => {
    const predicate = and(eq(member.organizationId, "org"), eq(member.userId, "owner-a"));
    if (ownership === "missing") await fixture.db.delete(member).where(predicate);
    else await fixture.db.update(member).set({ role: "admin" }).where(predicate);
    const before = await savedState();
    await expect(downgrade()).rejects.toThrow("must be an organization owner");
    expect(await savedState()).toEqual(before);
  },
);

it("publishes committed Membership IDs and Plan even if later billing reconciliation fails", async () => {
  mocks.afterCommit.mockRejectedValueOnce(new Error("reconciliation unavailable"));
  await expect(downgrade()).rejects.toThrow("reconciliation unavailable");
  expect((await savedState()).plan).toBe("hobby");
  expect(mocks.publish.mock.calls.map(([fact]) => fact)).toEqual([
    {
      type: "membership.removed",
      version: 1,
      subjectId: "owner-b",
      data: { membershipId: "owner-b", organizationId: "org", userId: "owner-b" },
    },
    {
      type: "organization.plan.changed",
      version: 1,
      subjectId: "org",
      data: { organizationId: "org", previousPlan: "pro", plan: "hobby" },
    },
  ]);
});

it.each(["throw", "reject"])(
  "preserves the downgrade and attempts each job when Graphile admission fails (%s)",
  async (failure) => {
    const enqueue = vi.fn(() => {
      if (failure === "throw") throw new Error("Graphile unavailable");
      return Promise.reject(new Error("Graphile unavailable"));
    });
    mocks.publish.mockImplementation(
      createEventPublisher({
        routes: [...membershipEventDefinitions, ...billingEventDefinitions].map((definition) => ({
          definition,
          job: (event) => ({ task: "test/downgrade", payload: event }),
        })),
        enqueue,
      }).publish,
    );
    await expect(downgrade()).resolves.toEqual({ removedMembers: 1, canceledInvitations: 1 });
    expect((await savedState()).plan).toBe("hobby");
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
  },
);
