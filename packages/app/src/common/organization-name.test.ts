import { describe, expect, it } from "vitest";
import { CreateOrganizationInputSchema } from "./organization-name";

describe("CreateOrganizationInputSchema", () => {
  it("rejects blank names", () => {
    expect(() =>
      CreateOrganizationInputSchema.parse({
        organizationName: " ",
        billingEmail: "billing@example.com",
      }),
    ).toThrow();
  });

  it("accepts valid names and normalizes the billing email", () => {
    expect(
      CreateOrganizationInputSchema.parse({
        organizationName: "Acme Inc",
        billingEmail: " Billing@Example.COM ",
      }),
    ).toEqual({
      organizationName: "Acme Inc",
      billingEmail: "billing@example.com",
    });
  });

  it("rejects invalid billing emails", () => {
    expect(() =>
      CreateOrganizationInputSchema.parse({
        organizationName: "Acme Inc",
        billingEmail: "not-an-email",
      }),
    ).toThrow();
  });
});
