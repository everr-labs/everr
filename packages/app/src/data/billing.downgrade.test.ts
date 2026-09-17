import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lockOwnership: vi.fn(),
  entitlement: vi.fn(),
  ownsHobby: vi.fn(),
  getRole: vi.fn(),
  revoke: vi.fn(),
  beforeBillingLock: vi.fn(),
  afterOwnershipLock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
  const chain = () => {
    const builder = {
      middleware: () => callable,
      inputValidator: () => callable,
      handler: (handler: unknown) => handler,
      server: () => callable,
    };
    const callable = Object.assign(() => callable, builder);
    return callable;
  };
  return { createServerFn: chain, createMiddleware: chain };
});
vi.mock("@/lib/serverFn", () => ({ requireOrgMiddleware: {} }));
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { getActiveMemberRole: mocks.getRole } },
}));
vi.mock("@/db/client", () => ({
  db: {
    transaction: mocks.transaction,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }),
  },
}));
vi.mock("@/lib/billing-data.server", () => ({
  lockHobbyOrganizationOwnership: mocks.lockOwnership,
  readOrgEntitlement: mocks.entitlement,
  userOwnsHobbyOrganization: mocks.ownsHobby,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers(),
}));
vi.mock("@/lib/billing/server", () => ({
  billing: {
    downgrade: async (
      _orgId: string,
      userId: string,
      commit: (revoke: () => Promise<void>) => Promise<unknown>,
    ) => {
      await mocks.beforeBillingLock();
      // Match the billing module's nonblocking organization lock and its
      // authorization check. The module itself has separate integration tests.
      if (billingLocked) throw new Error("Billing is being processed");
      billingLocked = true;
      try {
        if (!members.get(userId)?.split(",").includes("owner"))
          throw new Error("You cannot manage billing for this organization");
        return await commit(mocks.revoke);
      } finally {
        billingLocked = false;
      }
    },
  },
}));

import { organization } from "@/db/schema";
import { downgradeSuspendedOrganization } from "./billing";

let members: Map<string, string>;
let plan: "pro" | "hobby";
let billingLocked: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  members = new Map([
    ["owner-a", "owner"],
    ["owner-b", "owner"],
  ]);
  plan = "pro";
  billingLocked = false;
  mocks.getRole.mockResolvedValue({ role: "owner" });
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
            if (table === organization) plan = "hobby";
            return { returning: async () => [] };
          },
        }),
      }),
    };
    return run(tx);
  });
});

function downgrade(userId: string): Promise<unknown> {
  return Reflect.apply(downgradeSuspendedOrganization, undefined, [
    {
      context: {
        session: {
          user: { id: userId },
          session: { activeOrganizationId: "org" },
        },
      },
    },
  ]);
}

describe("suspended organization downgrade", () => {
  it("keeps the winning owner when two owners downgrade concurrently", async () => {
    const results = await Promise.allSettled([
      downgrade("owner-a"),
      downgrade("owner-b"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(members.size).toBe(1);
    expect([...members.values()]).toEqual(["owner"]);
    expect(plan).toBe("hobby");
  });

  it("rejects a caller whose owner membership has been removed", async () => {
    members.delete("owner-a");
    await expect(downgrade("owner-a")).rejects.toThrow("cannot manage billing");
    expect([...members.keys()]).toEqual(["owner-b"]);
    expect(plan).toBe("pro");
  });

  it("rechecks suspension before removing members", async () => {
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

it("rejects a removed owner even if the earlier role check succeeded", async () => {
  mocks.beforeBillingLock.mockImplementationOnce(() =>
    members.delete("owner-a"),
  );
  await expect(downgrade("owner-a")).rejects.toThrow("cannot manage billing");
  expect([...members.keys()]).toEqual(["owner-b"]);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
