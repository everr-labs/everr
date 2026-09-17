import { describe, expect, it } from "vitest";
import { CreateOrganizationInputSchema } from "./organization-name";

describe("organization creation input", () => {
  it.each(["hobby", "pro"])("accepts %s without a billing email", (plan) => {
    expect(
      CreateOrganizationInputSchema.parse({
        plan,
        organizationName: "  Acme  ",
      }),
    ).toEqual({ plan, organizationName: "Acme" });
  });
  it("rejects blank names", () => {
    expect(() =>
      CreateOrganizationInputSchema.parse({
        plan: "pro",
        organizationName: " ",
      }),
    ).toThrow();
  });
});
