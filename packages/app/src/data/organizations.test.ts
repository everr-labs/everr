import { getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth.server";
import { createOrganization } from "./organizations";

const polarMocks = vi.hoisted(() => ({
  assertEmailAvailable: vi.fn(),
  createCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  getCustomerForOrg: vi.fn(),
  linkCustomerToOrg: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(() => new Headers({ cookie: "session=test" })),
}));

vi.mock("@/lib/polar.server", () => ({
  assertPolarBillingEmailAvailable: polarMocks.assertEmailAvailable,
  createPolarCustomer: polarMocks.createCustomer,
  deleteProvisionalPolarCustomer: polarMocks.deleteCustomer,
  getPolarCustomerForOrg: polarMocks.getCustomerForOrg,
  linkPolarCustomerToOrg: polarMocks.linkCustomerToOrg,
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: vi.fn(() => ({})),
  serverLogger: { error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  polarMocks.assertEmailAvailable.mockResolvedValue(undefined);
  polarMocks.createCustomer.mockResolvedValue({ id: "polar_customer" });
  polarMocks.linkCustomerToOrg.mockResolvedValue({});
  polarMocks.getCustomerForOrg.mockResolvedValue(null);
  polarMocks.deleteCustomer.mockResolvedValue(undefined);
  vi.mocked(auth.api.deleteOrganization).mockResolvedValue({} as never);
});

describe("createOrganization", () => {
  it("creates an organization for the authenticated user", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);

    await expect(
      createOrganization({
        data: {
          organizationName: "  Acme  ",
          billingEmail: " Billing@Example.com ",
        },
      }),
    ).resolves.toEqual({ id: "org_new", name: "Acme" });

    expect(polarMocks.assertEmailAvailable).toHaveBeenCalledWith(
      "billing@example.com",
    );
    expect(polarMocks.createCustomer).toHaveBeenCalledWith({
      email: "billing@example.com",
      name: "Acme",
    });
    expect(auth.api.createOrganization).toHaveBeenCalledWith({
      body: {
        name: "Acme",
        slug: expect.stringMatching(/^org-/),
        userId: "test_user",
      },
    });
    expect(polarMocks.linkCustomerToOrg).toHaveBeenCalledWith({
      customerId: "polar_customer",
      orgId: "org_new",
    });
    expect(getRequestHeaders).toHaveBeenCalled();
  });

  it("rejects an invalid name before creating anything", async () => {
    await expect(
      createOrganization({
        data: { organizationName: " ", billingEmail: "billing@example.com" },
      }),
    ).rejects.toThrow();

    expect(auth.api.createOrganization).not.toHaveBeenCalled();
    expect(polarMocks.assertEmailAvailable).not.toHaveBeenCalled();
  });

  it("does not create an organization when Polar rejects the billing email", async () => {
    polarMocks.assertEmailAvailable.mockRejectedValueOnce(
      new Error("email unavailable"),
    );

    await expect(
      createOrganization({
        data: {
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).rejects.toThrow("email unavailable");

    expect(polarMocks.createCustomer).not.toHaveBeenCalled();
    expect(auth.api.createOrganization).not.toHaveBeenCalled();
  });

  it("deletes the provisional Polar customer when organization creation fails", async () => {
    vi.mocked(auth.api.createOrganization).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      createOrganization({
        data: {
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).rejects.toThrow("The organization could not be created.");

    expect(polarMocks.deleteCustomer).toHaveBeenCalledWith("polar_customer");
  });

  it("rolls both resources back when the Polar customer cannot be linked", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);
    polarMocks.linkCustomerToOrg.mockRejectedValueOnce(
      new Error("link failed"),
    );

    await expect(
      createOrganization({
        data: {
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).rejects.toThrow(
      "The billing customer could not be linked to the organization.",
    );

    expect(auth.api.deleteOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { organizationId: "org_new" },
    });
    expect(polarMocks.deleteCustomer).toHaveBeenCalledWith("polar_customer");
    expect(polarMocks.deleteCustomer.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(auth.api.deleteOrganization).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("keeps the organization recoverable when Polar rollback fails", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);
    polarMocks.linkCustomerToOrg.mockRejectedValueOnce(
      new Error("link failed"),
    );
    polarMocks.deleteCustomer.mockRejectedValueOnce(new Error("delete failed"));

    await expect(
      createOrganization({
        data: {
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).rejects.toThrow(
      "The billing customer could not be linked to the organization.",
    );

    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
  });

  it("accepts a successful link discovered after an uncertain response", async () => {
    vi.mocked(auth.api.createOrganization).mockResolvedValueOnce({
      id: "org_new",
      name: "Acme",
    } as never);
    polarMocks.linkCustomerToOrg.mockRejectedValueOnce(new Error("timeout"));
    polarMocks.getCustomerForOrg.mockResolvedValueOnce({
      id: "polar_customer",
    });

    await expect(
      createOrganization({
        data: {
          organizationName: "Acme",
          billingEmail: "billing@example.com",
        },
      }),
    ).resolves.toEqual({ id: "org_new", name: "Acme" });

    expect(auth.api.deleteOrganization).not.toHaveBeenCalled();
    expect(polarMocks.deleteCustomer).not.toHaveBeenCalled();
  });
});
