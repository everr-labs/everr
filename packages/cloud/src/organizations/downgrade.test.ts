import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lockOwnership: vi.fn(),
  entitlement: vi.fn(),
  ownsHobby: vi.fn(),
  revoke: vi.fn(),
  beforeBillingLock: vi.fn(),
  afterOwnershipLock: vi.fn(),
}));

vi.mock("@everr/app/identity/server", () => ({
  auth: { api: {} },
}));
vi.mock("@everr/app/db/client", () => ({
  db: {
    transaction: mocks.transaction,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
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
      return commit(mocks.revoke);
    },
  },
}));

import { organizationBilling } from "../db/schema";
import { organizationCommands } from "./commands.server";

let members: Map<string, string>;
let plan: "pro" | "hobby";

beforeEach(() => {
  vi.clearAllMocks();
  members = new Map([
    ["owner-a", "owner"],
    ["owner-b", "owner"],
  ]);
  plan = "pro";
  mocks.entitlement.mockImplementation(async () => ({
    appState: plan === "pro" ? "suspended" : "hobby",
  }));
  mocks.ownsHobby.mockResolvedValue(false);
  mocks.lockOwnership.mockImplementation(async (tx, userId) => {
    tx.userId = userId;
    await mocks.afterOwnershipLock();
  });
  mocks.transaction.mockImplementation(async (run) => {
    const tx = {
      userId: "",
      delete: () => ({
        where: () => ({
          returning: async () => {
            const removed = [...members.keys()].filter(
              (id) => id !== tx.userId,
            );
            for (const id of removed) members.delete(id);
            return removed.map((id) => ({ id }));
          },
        }),
      }),
      update: (table: unknown) => ({
        set: () => ({
          where: () => {
            if (table === organizationBilling) plan = "hobby";
            return { returning: async () => [] };
          },
        }),
      }),
    };
    return run(tx);
  });
});

function downgrade(actorId: string) {
  return organizationCommands.downgradeToHobby({
    organizationId: "org",
    actorId,
  });
}

describe("suspended organization downgrade", () => {
  it("downgrades an eligible organization and retains its Owner", async () => {
    await expect(downgrade("owner-a")).resolves.toEqual({
      removedMembers: 1,
      canceledInvitations: 0,
    });
    expect([...members.keys()]).toEqual(["owner-a"]);
    expect(plan).toBe("hobby");
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it("rechecks suspension after acquiring the billing lock", async () => {
    mocks.beforeBillingLock.mockImplementationOnce(() => {
      mocks.entitlement.mockResolvedValue({ appState: "pro" });
    });
    await expect(downgrade("owner-a")).rejects.toThrow("Only a suspended Pro");
    expect(members.size).toBe(2);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("preserves members when the owner already owns another Hobby organization", async () => {
    mocks.ownsHobby.mockResolvedValue(true);
    await expect(downgrade("owner-a")).rejects.toThrow("already own a Hobby");
    expect(members.size).toBe(2);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});

it("rechecks suspension after waiting for the Hobby ownership lock", async () => {
  mocks.afterOwnershipLock.mockImplementationOnce(() => {
    mocks.entitlement.mockResolvedValue({ appState: "pro" });
  });
  await expect(downgrade("owner-a")).rejects.toThrow("Only a suspended Pro");
  expect(members.size).toBe(2);
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("preserves memberships and the plan when provider revocation fails", async () => {
  mocks.revoke.mockRejectedValueOnce(new Error("Provider unavailable"));
  await expect(downgrade("owner-a")).rejects.toThrow("Provider unavailable");
  expect(members.size).toBe(2);
  expect(plan).toBe("pro");
});
