import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  customer: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  subscription: vi.fn(),
  upsert: vi.fn(),
  setPlan: vi.fn(),
  portal: vi.fn(),
  team: vi.fn(),
  billingMember: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createMiddleware: () => ({ middleware: () => ({ server: () => ({}) }) }),
  createServerFn: () => {
    const chain = {
      middleware: () => Object.assign(() => chain, chain),
      inputValidator: () => chain,
      handler:
        (
          fn: (args: {
            data: unknown;
            context: { orgId: string; session: { user: { id: string } } };
          }) => unknown,
        ) =>
        (args?: { data?: unknown }) =>
          fn({
            data: args?.data,
            context: { orgId: "org", session: { user: { id: "owner" } } },
          }),
    };
    return Object.assign(() => chain, chain);
  },
}));
vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://app.example", POLAR_PRO_PRODUCT_ID: "pro" },
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/serverFn", () => ({ requireOrgMiddleware: {} }));
vi.mock("@/lib/auth.server", () => ({ auth: { api: {} } }));
vi.mock("@/lib/billing-data.server", () => ({
  upsertOrgSubscription: mocks.upsert,
  setOrganizationPlan: mocks.setPlan,
}));
vi.mock("@/lib/polar-team.server", () => ({
  ensureOrganizationTeamCustomer: mocks.team,
  ensurePolarBillingMember: mocks.billingMember,
  readBillingPerson: vi.fn().mockResolvedValue({
    id: "owner",
    email: "owner@example.com",
    name: "Owner",
  }),
}));
vi.mock("@/lib/polar.server", () => ({
  getPolarCustomerForOrg: mocks.customer,
  getPolarCheckoutSubscription: mocks.subscription,
  polarClient: {
    checkouts: { create: mocks.create, get: mocks.get },
    customers: { getExternal: mocks.customer },
    customerSessions: { create: mocks.portal },
  },
}));

import {
  confirmOrgCheckout,
  getOrgPortalUrl,
  startOrgCheckout,
} from "./billing";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.team.mockResolvedValue({ id: "team" });
  mocks.billingMember.mockResolvedValue({ id: "member" });
  mocks.portal.mockResolvedValue({
    customerPortalUrl: "https://polar.example/portal",
  });
  mocks.create.mockResolvedValue({ url: "https://polar.example/checkout" });
});
it("binds an upgrade to a team customer without collecting an email", async () => {
  mocks.customer.mockResolvedValue(null);
  await startOrgCheckout({ data: { slug: "pro" } });
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      customerId: "team",
      allowTrial: false,
      metadata: { orgId: "org", userId: "owner" },
    }),
  );
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("customerEmail");
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty(
    "externalCustomerId",
  );
});
it("keeps an existing customer attached by its Polar ID", async () => {
  mocks.team.mockResolvedValue({ id: "existing" });
  await startOrgCheckout({ data: { slug: "pro" } });
  expect(mocks.create.mock.calls[0][0]).toMatchObject({
    customerId: "existing",
  });
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty(
    "externalCustomerId",
  );
});
it("does not grant Pro when a checkout reuses another organization's customer", async () => {
  mocks.get.mockResolvedValue({
    status: "succeeded",
    customerId: "foreign",
    externalCustomerId: "org",
    productId: "pro",
  });
  mocks.customer.mockResolvedValue(null);
  await expect(
    confirmOrgCheckout({ data: { checkoutId: "checkout" } }),
  ).resolves.toEqual({ status: "billing_conflict" });
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("confirms an existing customer even when checkout externalCustomerId is absent", async () => {
  mocks.get.mockResolvedValue({
    status: "succeeded",
    customerId: "existing",
    externalCustomerId: null,
    productId: "pro",
  });
  mocks.customer.mockResolvedValue({ id: "existing" });
  mocks.subscription.mockResolvedValue({
    id: "sub",
    productId: "pro",
    status: "active",
    createdAt: new Date(),
  });
  await expect(
    confirmOrgCheckout({ data: { checkoutId: "checkout" } }),
  ).resolves.toEqual({ status: "completed" });
  expect(mocks.setPlan).toHaveBeenCalledWith("org", "pro");
});

it("creates a member-scoped portal session", async () => {
  mocks.customer.mockResolvedValue({ id: "team", type: "team" });
  await expect(getOrgPortalUrl()).resolves.toMatchObject({ status: "ready" });
  expect(mocks.portal).toHaveBeenCalledWith({
    customerId: "team",
    memberId: "member",
  });
});
it("does not provision a customer when opening a missing portal", async () => {
  mocks.customer.mockResolvedValue(null);
  await expect(getOrgPortalUrl()).resolves.toEqual({
    status: "customer_missing",
  });
  expect(mocks.team).not.toHaveBeenCalled();
  expect(mocks.portal).not.toHaveBeenCalled();
});
it("does not start checkout when customer provisioning fails", async () => {
  mocks.team.mockRejectedValue(new Error("Polar unavailable"));
  await expect(startOrgCheckout({ data: { slug: "pro" } })).rejects.toThrow(
    "Polar unavailable",
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
