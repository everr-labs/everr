import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeProOrganizationCheckout } from "@/cloud/data/organization-checkout";
import { createOrganization } from "@/cloud/data/organizations";
import { auth } from "@/lib/auth.server";

const mocks = vi.hoisted(() => ({
  startCheckout: vi.fn(),
  finalizeProOrganizationCheckout: vi.fn(),
  getSession: vi.fn(),
  createAuthOrganization: vi.fn(),
  userOwnsHobbyOrganization: vi.fn(),
  lockOrganizationOwnership: vi.fn(),
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

vi.mock("@/cloud/billing-data.server", () => ({
  userOwnsHobbyOrganization: mocks.userOwnsHobbyOrganization,
}));
vi.mock("@/product/organization-lock.server", () => ({
  lockOrganizationOwnership: mocks.lockOrganizationOwnership,
}));

vi.mock("@/db/client", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@/cloud/billing/server", () => ({
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
  mocks.lockOrganizationOwnership.mockResolvedValue(undefined);
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
      },
    });
    expect(mocks.lockOrganizationOwnership).toHaveBeenCalledWith(
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

  it("starts Pro checkout with the name and destination, without creating the organization", async () => {
    await expect(
      createOrganization({
        data: {
          plan: "pro",
          organizationName: "  Acme  ",
          returnTo: "/logs?service=api",
        },
      }),
    ).resolves.toEqual({
      kind: "checkout",
      url: "https://polar.example/checkout_1",
    });
    expect(mocks.startCheckout).toHaveBeenCalledWith(
      "test_user",
      "Acme",
      "/logs?service=api",
    );
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    "https://other.example",
    "//other.example",
    "/organization-setup",
  ])("defaults a missing or unsafe checkout destination (%s) to home", async (returnTo) => {
    await createOrganization({
      data: { plan: "pro", organizationName: "Acme", returnTo },
    });
    expect(mocks.startCheckout).toHaveBeenCalledWith(
      "test_user",
      "Acme",
      returnTo === undefined ? undefined : "/",
    );
  });
  it("reports a retryable checkout failure", async () => {
    mocks.startCheckout.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      createOrganization({ data: { plan: "pro", organizationName: "Acme" } }),
    ).rejects.toThrow("Please try again");
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });
});

vi.mock("@/cloud/app/env", async () => ({
  appEnv: (await import("@/env")).env,
}));
