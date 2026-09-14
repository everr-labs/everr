import { HTTPValidationError } from "@polar-sh/sdk/models/errors/httpvalidationerror";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingEmailUnavailableError } from "@/common/organization-name";

vi.mock("@/env", () => ({
  env: {
    POLAR_ACCESS_TOKEN: "polar_test_token",
    POLAR_SERVER: "sandbox",
  },
}));

import {
  assertPolarBillingEmailAvailable,
  createPolarCustomer,
  deleteProvisionalPolarCustomer,
  polarClient,
  prepareProOrganizationCheckoutCustomer,
} from "./polar.server";

const metadata = {
  everrPurpose: "create_pro_organization",
  everrOwnerId: "owner_1",
  everrOrganizationName: "Acme",
  everrOrganizationSlug: "acme-checkout",
  everrSchemaVersion: 1,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Polar organization customers", () => {
  it("checks the exact email before organization creation", async () => {
    const list = vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: { items: [], pagination: {} },
    } as never);

    await expect(
      assertPolarBillingEmailAvailable("billing@example.com"),
    ).resolves.toBeUndefined();

    expect(list).toHaveBeenCalledWith({
      email: "billing@example.com",
      limit: 1,
    });
  });

  it("rejects a billing email already used by a Polar customer", async () => {
    vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: {
        items: [{ id: "existing_customer" }],
        pagination: {},
      },
    } as never);

    await expect(
      assertPolarBillingEmailAvailable("billing@example.com"),
    ).rejects.toBeInstanceOf(BillingEmailUnavailableError);
  });

  it("maps a create-time email race to the public unavailable error", async () => {
    const request = new Request("https://api.polar.sh/v1/customers", {
      method: "POST",
    });
    const response = new Response(null, { status: 422 });
    vi.spyOn(polarClient.customers, "create").mockRejectedValue(
      new HTTPValidationError(
        {
          detail: [
            {
              loc: ["body", "email"],
              msg: "A customer with this email address already exists.",
              type: "value_error",
            },
          ],
        },
        { request, response, body: "" },
      ),
    );

    await expect(
      createPolarCustomer({
        email: "billing@example.com",
        name: "Acme",
      }),
    ).rejects.toBeInstanceOf(BillingEmailUnavailableError);
  });

  it("anonymizes provisional customers during rollback", async () => {
    const deleteCustomer = vi
      .spyOn(polarClient.customers, "delete")
      .mockResolvedValue(undefined);

    await deleteProvisionalPolarCustomer("polar_customer");

    expect(deleteCustomer).toHaveBeenCalledWith({
      id: "polar_customer",
      anonymize: true,
    });
  });

  it("stores ownership metadata on a new provisional customer", async () => {
    vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: { items: [], pagination: {} },
    } as never);
    const create = vi
      .spyOn(polarClient.customers, "create")
      .mockResolvedValue({ id: "polar_customer" } as never);

    await expect(
      prepareProOrganizationCheckoutCustomer({
        email: "billing@example.com",
        name: "Acme",
        metadata,
      }),
    ).resolves.toEqual({
      kind: "customer",
      customerId: "polar_customer",
      created: true,
    });

    expect(create).toHaveBeenCalledWith({
      email: "billing@example.com",
      name: "Acme",
      externalId: undefined,
      metadata,
    });
  });

  it("resumes an open checkout owned by the same user", async () => {
    vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "polar_customer",
            externalId: null,
            metadata,
          },
        ],
        pagination: {},
      },
    } as never);
    vi.spyOn(polarClient.checkouts, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "checkout_open",
            status: "open",
            url: "https://polar.example/checkout_open",
            expiresAt: new Date(Date.now() + 60_000),
            metadata,
          },
        ],
        pagination: {},
      },
    } as never);
    const update = vi.spyOn(polarClient.customers, "update");

    await expect(
      prepareProOrganizationCheckoutCustomer({
        email: "billing@example.com",
        name: "Acme",
        metadata,
      }),
    ).resolves.toEqual({
      kind: "checkout",
      checkout: {
        id: "checkout_open",
        status: "open",
        url: "https://polar.example/checkout_open",
      },
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("reuses the same customer's email after its checkout expires", async () => {
    vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "polar_customer",
            externalId: null,
            metadata,
          },
        ],
        pagination: {},
      },
    } as never);
    vi.spyOn(polarClient.checkouts, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "checkout_expired",
            status: "expired",
            url: "https://polar.example/checkout_expired",
            metadata,
          },
        ],
        pagination: {},
      },
    } as never);
    const update = vi
      .spyOn(polarClient.customers, "update")
      .mockResolvedValue({ id: "polar_customer" } as never);

    await expect(
      prepareProOrganizationCheckoutCustomer({
        email: "billing@example.com",
        name: "Acme renamed",
        metadata: { ...metadata, everrOrganizationSlug: "acme-retry" },
      }),
    ).resolves.toEqual({
      kind: "customer",
      customerId: "polar_customer",
      created: false,
    });

    expect(update).toHaveBeenCalledWith({
      id: "polar_customer",
      customerUpdate: {
        name: "Acme renamed",
        metadata: { ...metadata, everrOrganizationSlug: "acme-retry" },
      },
    });
  });

  it("does not let another user claim an abandoned customer", async () => {
    vi.spyOn(polarClient.customers, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "polar_customer",
            externalId: null,
            metadata: { ...metadata, everrOwnerId: "owner_2" },
          },
        ],
        pagination: {},
      },
    } as never);
    vi.spyOn(polarClient.checkouts, "list").mockResolvedValue({
      result: { items: [], pagination: {} },
    } as never);

    await expect(
      prepareProOrganizationCheckoutCustomer({
        email: "billing@example.com",
        name: "Acme",
        metadata,
      }),
    ).rejects.toBeInstanceOf(BillingEmailUnavailableError);
  });

  it("recovers a create-time email race by resuming the winning checkout", async () => {
    vi.spyOn(polarClient.customers, "list")
      .mockResolvedValueOnce({
        result: { items: [], pagination: {} },
      } as never)
      .mockResolvedValueOnce({
        result: {
          items: [
            {
              id: "polar_customer",
              externalId: null,
              metadata,
            },
          ],
          pagination: {},
        },
      } as never);
    const request = new Request("https://api.polar.sh/v1/customers", {
      method: "POST",
    });
    const response = new Response(null, { status: 422 });
    vi.spyOn(polarClient.customers, "create").mockRejectedValue(
      new HTTPValidationError(
        {
          detail: [
            {
              loc: ["body", "email"],
              msg: "A customer with this email address already exists.",
              type: "value_error",
            },
          ],
        },
        { request, response, body: "" },
      ),
    );
    vi.spyOn(polarClient.checkouts, "list").mockResolvedValue({
      result: {
        items: [
          {
            id: "checkout_open",
            status: "open",
            url: "https://polar.example/checkout_open",
            expiresAt: new Date(Date.now() + 60_000),
            metadata,
          },
        ],
        pagination: {},
      },
    } as never);

    await expect(
      prepareProOrganizationCheckoutCustomer({
        email: "billing@example.com",
        name: "Acme",
        metadata,
      }),
    ).resolves.toEqual({
      kind: "checkout",
      checkout: {
        id: "checkout_open",
        status: "open",
        url: "https://polar.example/checkout_open",
      },
    });
  });
});
