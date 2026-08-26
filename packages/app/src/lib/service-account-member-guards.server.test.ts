import { beforeEach, describe, expect, it, vi } from "vitest";

// The select result stands in for the `user` row the guards read, looked up
// by id or by address. `isServiceAccount: true` is a machine principal,
// `false` is a person, and an empty array is an address nobody holds.
// Mutated per test, restored via beforeEach so tests stay independent.
let selectResult: Array<{ isServiceAccount: boolean }> = [
  { isServiceAccount: true },
];

function makeSelectChain() {
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder passthrough mock has no fixed shape.
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => selectResult,
  };
  return chain;
}

vi.mock("@/db/client", () => ({
  db: {
    select: () => makeSelectChain(),
  },
}));

vi.mock("@/db/schema", () => ({
  user: {
    id: "user.id",
    email: "user.email",
    isServiceAccount: "user.is_service_account",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

beforeEach(() => {
  selectResult = [{ isServiceAccount: true }];
});

describe("assertRoleChangeAllowed", () => {
  it("allows a role change that is not a promotion to owner", async () => {
    const { assertRoleChangeAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertRoleChangeAllowed("user-1", "admin"),
    ).resolves.toBeUndefined();
  });

  it("refuses promoting a service account's member to owner", async () => {
    const { assertRoleChangeAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(assertRoleChangeAllowed("user-1", "owner")).rejects.toThrow(
      /owner role/i,
    );
  });

  it("allows promoting a human member to owner", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertRoleChangeAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertRoleChangeAllowed("human-1", "owner"),
    ).resolves.toBeUndefined();
  });
});

describe("assertOrganizationCreatorAllowed", () => {
  it("refuses a service account creating an organization", async () => {
    // The organization row is written before the creator's member row, so a
    // refusal any later leaves an organization nobody can delete.
    const { assertOrganizationCreatorAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(assertOrganizationCreatorAllowed("user-1")).rejects.toThrow(
      /organization/i,
    );
  });

  it("allows a person creating an organization", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertOrganizationCreatorAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertOrganizationCreatorAllowed("human-1"),
    ).resolves.toBeUndefined();
  });
});

describe("assertMemberAdditionAllowed", () => {
  it("refuses adding a service account to an organization, whatever the role", async () => {
    // A second membership would leave the account with no defined
    // organization, because the membership is what says which one it is.
    const { assertMemberAdditionAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(assertMemberAdditionAllowed("user-1")).rejects.toThrow(
      /service account/i,
    );
  });

  it("allows adding a human", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertMemberAdditionAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertMemberAdditionAllowed("human-1"),
    ).resolves.toBeUndefined();
  });
});

describe("assertInvitationRecipientAllowed", () => {
  it("refuses an invitation addressed to a service account", async () => {
    const { assertInvitationRecipientAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertInvitationRecipientAllowed("sa-1@svc.everr.invalid"),
    ).rejects.toThrow(/service account/i);
  });

  it("allows an invitation addressed to a person", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertInvitationRecipientAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertInvitationRecipientAllowed("gio@example.com"),
    ).resolves.toBeUndefined();
  });
});

describe("assertInvitationAcceptorAllowed", () => {
  it("refuses a service account accepting an invitation", async () => {
    const { assertInvitationAcceptorAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(assertInvitationAcceptorAllowed("user-1")).rejects.toThrow(
      /service account/i,
    );
  });

  it("allows a person accepting an invitation", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertInvitationAcceptorAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertInvitationAcceptorAllowed("human-1"),
    ).resolves.toBeUndefined();
  });
});

describe("assertMemberRemovalAllowed", () => {
  it("refuses removing a service account's membership", async () => {
    const { assertMemberRemovalAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(assertMemberRemovalAllowed("user-1")).rejects.toThrow(
      /orphan/i,
    );
  });

  it("allows removing a human member's membership", async () => {
    selectResult = [{ isServiceAccount: false }];
    const { assertMemberRemovalAllowed } = await import(
      "./service-account-member-guards.server"
    );
    await expect(
      assertMemberRemovalAllowed("human-1"),
    ).resolves.toBeUndefined();
  });
});
