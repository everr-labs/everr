import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import {
  completeProOrganizationCheckout,
  createOrganization,
} from "./organizations";

const mocks = vi.hoisted(() => ({
  startCheckout: vi.fn(),
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
}));

vi.mock("@/lib/billing-data.server", () => ({
  lockHobbyOrganizationOwnership: mocks.lockHobbyOrganizationOwnership,
  userOwnsHobbyOrganization: mocks.userOwnsHobbyOrganization,
}));

vi.mock("@/db/client", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@/lib/billing/server", () => ({
  billing: {
    startNewOrganizationCheckout: mocks.startCheckout,
    completeNewOrganizationCheckout: mocks.finalizeProOrganizationCheckout,
  },
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
  mocks.startCheckout.mockResolvedValue({
    kind: "checkout",
    url: "https://polar.example/checkout_1",
  });
  mocks.finalizeProOrganizationCheckout.mockResolvedValue({
    status: "completed",
    organization: { id: "org_new", name: "Acme" },
  });
});

it("passes authenticated identity and checkout ID to the billing module", async () => {
  await completeProOrganizationCheckout({ data: { checkoutId: "checkout" } });
  expect(mocks.finalizeProOrganizationCheckout).toHaveBeenCalledWith(
    "checkout",
    "test_user",
    expect.any(Function),
  );
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

    expect(mocks.startCheckout).not.toHaveBeenCalled();
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

  it("starts Pro checkout with only the name, without creating the organization", async () => {
    await expect(
      createOrganization({
        data: { plan: "pro", organizationName: "  Acme  " },
      }),
    ).resolves.toEqual({
      kind: "checkout",
      url: "https://polar.example/checkout_1",
    });
    expect(mocks.startCheckout).toHaveBeenCalledWith("test_user", "Acme");
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
  it("reports a retryable checkout failure", async () => {
    mocks.startCheckout.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      createOrganization({ data: { plan: "pro", organizationName: "Acme" } }),
    ).rejects.toThrow("Please try again");
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
});
