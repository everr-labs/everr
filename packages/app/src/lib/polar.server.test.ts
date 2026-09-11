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
} from "./polar.server";

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
});
