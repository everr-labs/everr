import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  createMember: vi.fn(),
  updateMember: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/polar.server", () => ({
  getPolarCustomerForOrg: mocks.get,
  polarClient: {
    customers: { create: mocks.create, update: mocks.update },
    members: {
      listMembers: mocks.list,
      createMember: mocks.createMember,
      updateMember: mocks.updateMember,
    },
  },
}));

import {
  ensurePolarBillingMember,
  ensurePolarTeamCustomer,
  readOrganizationBillingOwner,
} from "./polar-team.server";

const owner = { id: "owner", email: "person@example.com", name: "Person" };
const team = { id: "customer", externalId: "org", type: "team" };
const member = {
  id: "member",
  customerId: "customer",
  externalId: owner.id,
  email: owner.email,
  role: "owner",
};
function pages(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { result: { items } };
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.create.mockResolvedValue(team);
  mocks.list.mockResolvedValue(pages([member]));
  mocks.updateMember.mockImplementation(async ({ id, memberUpdate }) => ({
    ...member,
    id,
    ...memberUpdate,
  }));
});
it("creates a team with the organization owner's personal email only on its member", async () => {
  await ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner });
  expect(mocks.create).toHaveBeenCalledWith({
    type: "team",
    externalId: "org",
    name: "Acme",
    owner: { externalId: owner.id, email: owner.email, name: owner.name },
  });
  expect(mocks.createMember).not.toHaveBeenCalled();
});
it("allows the same owner email on separate organization customers", async () => {
  mocks.create.mockImplementation(async (input) => ({
    id: input.externalId,
    externalId: input.externalId,
    type: "team",
  }));
  mocks.list.mockImplementation(async ({ customerId }) =>
    pages([{ ...member, customerId }]),
  );
  const first = await ensurePolarTeamCustomer({ orgId: "a", name: "A", owner });
  const second = await ensurePolarTeamCustomer({
    orgId: "b",
    name: "B",
    owner,
  });
  expect(first.id).not.toBe(second.id);
  expect(mocks.create.mock.calls.map(([input]) => input.owner.email)).toEqual([
    owner.email,
    owner.email,
  ]);
});
it("recovers a lost response or competing creation by external ID", async () => {
  mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(team);
  mocks.create.mockRejectedValue(new Error("timeout"));
  await expect(
    ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner }),
  ).resolves.toEqual(team);
  expect(mocks.get).toHaveBeenNthCalledWith(2, "org");
});
it("fails safely when an uncertain creation cannot be reconciled", async () => {
  mocks.create.mockRejectedValue(new Error("timeout"));
  await expect(
    ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner }),
  ).rejects.toThrow("timeout");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("upgrades an existing individual in place and transfers ownership to the org owner", async () => {
  mocks.get.mockResolvedValue({ ...team, type: "individual" });
  mocks.update.mockResolvedValue(team);
  mocks.list.mockResolvedValue(pages([]));
  mocks.createMember.mockResolvedValue({ ...member, role: "billing_manager" });
  await ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith({
    id: "customer",
    customerUpdate: { type: "team" },
  });
  expect(mocks.updateMember).toHaveBeenCalledWith({
    id: "member",
    memberUpdate: { role: "owner" },
  });
});
it("rejects a customer with an inconsistent organization ID", async () => {
  mocks.get.mockResolvedValue({ ...team, externalId: "foreign" });
  await expect(
    ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner }),
  ).rejects.toThrow("another organization");
  expect(mocks.list).not.toHaveBeenCalled();
});
it("rejects an email associated with a different user inside the same customer", async () => {
  mocks.list.mockResolvedValue(
    pages([{ ...member, externalId: "foreign-user" }]),
  );
  await expect(
    ensurePolarBillingMember("customer", owner, "owner"),
  ).rejects.toThrow("identity");
  expect(mocks.updateMember).not.toHaveBeenCalled();
});
it("does not demote the owner when opening their portal", async () => {
  await ensurePolarBillingMember("customer", owner, "billing_manager");
  expect(mocks.updateMember).not.toHaveBeenCalled();
});
it("selects the actual organization owner even when another admin starts checkout", async () => {
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: vi.fn().mockResolvedValue([
      { ...owner, id: "admin", role: "admin", organizationName: "Acme" },
      { ...owner, role: "owner", organizationName: "Acme" },
    ]),
  };
  mocks.select.mockReturnValue(query);
  await expect(readOrganizationBillingOwner("org")).resolves.toMatchObject({
    id: "owner",
  });
});

it("reuses a legacy auto-created owner whose external ID was the organization ID", async () => {
  mocks.get.mockResolvedValue({ ...team, type: "individual" });
  mocks.update.mockResolvedValue(team);
  mocks.list.mockResolvedValue(pages([{ ...member, externalId: "org" }]));
  await ensurePolarTeamCustomer({ orgId: "org", name: "Acme", owner });
  expect(mocks.createMember).not.toHaveBeenCalled();
  expect(mocks.updateMember).not.toHaveBeenCalled();
});
