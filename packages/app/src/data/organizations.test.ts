import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import {
  completeProOrganizationCheckout,
  createOrganization,
} from "./organizations";

const mocks = vi.hoisted(() => ({
  assertEmailAvailable: vi.fn(),
  createCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  checkoutCreate: vi.fn(),
  checkoutGet: vi.fn(),
  subscriptionGet: vi.fn(),
  finalizeProOrganizationCheckout: vi.fn(),
  getSession: vi.fn(),
  createAuthOrganization: vi.fn(),
  userOwnsHobbyOrganization: vi.fn(),
  lockHobbyOrganizationOwnership: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/env", () => ({
  env: {
    BETTER_AUTH_URL: "https://app.example",
    POLAR_PRO_PRODUCT_ID: "product_pro",
  },
}));

vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      createOrganization: mocks.createAuthOrganization,
    },
  },
  finalizeProOrganizationCheckout: mocks.finalizeProOrganizationCheckout,
}));

vi.mock("@/lib/billing-data.server", () => ({
  lockHobbyOrganizationOwnership: mocks.lockHobbyOrganizationOwnership,
  userOwnsHobbyOrganization: mocks.userOwnsHobbyOrganization,
}));

vi.mock("@/db/client", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@/lib/polar.server", () => ({
  assertPolarBillingEmailAvailable: mocks.assertEmailAvailable,
  createPolarCustomer: mocks.createCustomer,
  deleteProvisionalPolarCustomer: mocks.deleteCustomer,
  polarClient: {
    checkouts: { create: mocks.checkoutCreate, get: mocks.checkoutGet },
    subscriptions: { get: mocks.subscriptionGet },
  },
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: vi.fn(() => ({})),
  serverLogger: { error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({
    user: {
      id: "test_user",
      email: "test@example.com",
      name: "Test User",
      image: null,
    },
    session: { id: "test_session", activeOrganizationId: "test_org" },
  });
  mocks.userOwnsHobbyOrganization.mockResolvedValue(false);
  mocks.transaction.mockImplementation(async (fn) => fn({}));
  mocks.lockHobbyOrganizationOwnership.mockResolvedValue(undefined);
  mocks.assertEmailAvailable.mockResolvedValue(undefined);
  mocks.createCustomer.mockResolvedValue({ id: "polar_customer" });
  mocks.deleteCustomer.mockResolvedValue(undefined);
  mocks.checkoutCreate.mockResolvedValue({
    id: "checkout_1",
    url: "https://polar.example/checkout_1",
  });
  mocks.finalizeProOrganizationCheckout.mockResolvedValue({
    status: "completed",
    organization: { id: "org_new", name: "Acme" },
  });
});

describe("completeProOrganizationCheckout", () => {
  const metadata = {
    everrPurpose: "create_pro_organization",
    everrOwnerId: "test_user",
    everrOrganizationName: "Acme",
    everrOrganizationSlug: "acme-checkout",
    everrSchemaVersion: 1,
  } as const;

  it("waits while Polar has only confirmed the checkout", async () => {
    mocks.checkoutGet.mockResolvedValueOnce({
      id: "checkout_1",
      status: "confirmed",
      metadata,
    });

    await expect(
      completeProOrganizationCheckout({ data: { checkoutId: "checkout_1" } }),
    ).resolves.toEqual({ status: "processing" });

    expect(mocks.finalizeProOrganizationCheckout).not.toHaveBeenCalled();
  });

  it("finalizes only a succeeded checkout with an active Pro subscription", async () => {
    mocks.checkoutGet.mockResolvedValueOnce({
      id: "checkout_1",
      status: "succeeded",
      productId: "product_pro",
      subscriptionId: "subscription_1",
      customerId: "polar_customer",
      metadata,
    });
    const createdAt = new Date("2026-09-11T12:00:00Z");
    mocks.subscriptionGet.mockResolvedValueOnce({
      id: "subscription_1",
      productId: "product_pro",
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      modifiedAt: null,
      createdAt,
    });

    await expect(
      completeProOrganizationCheckout({ data: { checkoutId: "checkout_1" } }),
    ).resolves.toEqual({
      status: "completed",
      organization: { id: "org_new", name: "Acme" },
    });

    expect(mocks.finalizeProOrganizationCheckout).toHaveBeenCalledWith({
      metadata,
      customerId: "polar_customer",
      subscription: {
        id: "subscription_1",
        productId: "product_pro",
        status: "active",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        modifiedAt: null,
        createdAt,
      },
    });
  });

  it("rejects a checkout owned by another user", async () => {
    mocks.checkoutGet.mockResolvedValueOnce({
      id: "checkout_1",
      status: "succeeded",
      productId: "product_pro",
      subscriptionId: "subscription_1",
      customerId: "polar_customer",
      metadata: { ...metadata, everrOwnerId: "another_user" },
    });

    await expect(
      completeProOrganizationCheckout({ data: { checkoutId: "checkout_1" } }),
    ).rejects.toThrow("This checkout is not available");

    expect(mocks.subscriptionGet).not.toHaveBeenCalled();
    expect(mocks.finalizeProOrganizationCheckout).not.toHaveBeenCalled();
  });
});

describe("createOrganization", () => {
  it("creates a Hobby organization without Polar", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);

    await expect(
      createOrganization({
        data: { plan: "hobby", organizationName: "  Acme  " },
      }),
    ).resolves.toEqual({
      kind: "created",
      organization: { id: "org_new", name: "Acme" },
    });

    expect(mocks.assertEmailAvailable).not.toHaveBeenCalled();
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.createAuthOrganization).toHaveBeenCalledWith({
      body: {
        name: "Acme",
        slug: expect.any(String),
        userId: "test_user",
        plan: "hobby",
      },
    });
    expect(mocks.lockHobbyOrganizationOwnership).toHaveBeenCalledWith(
      expect.anything(),
      "test_user",
    );
  });

  it("rejects a second owned Hobby organization", async () => {
    mocks.userOwnsHobbyOrganization.mockResolvedValueOnce(true);

    await expect(
      createOrganization({
        data: { plan: "hobby", organizationName: "Acme" },
      }),
    ).rejects.toThrow("already own a Hobby organization");

    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });

  it("starts Pro checkout without creating the organization", async () => {
    await expect(
      createOrganization({
        data: {
          plan: "pro",
          organizationName: "  Acme  ",
          billingEmail: " Billing@Example.com ",
        },
      }),
    ).resolves.toEqual({
      kind: "checkout",
      url: "https://polar.example/checkout_1",
    });

    expect(mocks.assertEmailAvailable).toHaveBeenCalledWith(
      "billing@example.com",
    );
    expect(mocks.createCustomer).toHaveBeenCalledWith({
      email: "billing@example.com",
      name: "Acme",
    });
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "polar_customer",
        allowTrial: false,
        metadata: {
          everrPurpose: "create_pro_organization",
          everrOwnerId: "test_user",
          everrOrganizationName: "Acme",
          everrOrganizationSlug: expect.any(String),
          everrSchemaVersion: 1,
        },
      }),
    );
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });

  it("removes the provisional customer when checkout fails", async () => {
    mocks.checkoutCreate.mockRejectedValueOnce(new Error("Polar unavailable"));

    await expect(
      createOrganization({
        data: {
          plan: "pro",
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).rejects.toThrow("Pro checkout could not be started");

    expect(mocks.deleteCustomer).toHaveBeenCalledWith("polar_customer");
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
});
