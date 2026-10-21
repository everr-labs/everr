import { describe, expect, it } from "vite-plus/test";
import { CreateOrganizationInputSchema, deriveOrgName } from "./organization-name";

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

it.each([
  ["Jane Doe", "jane@example.com", "Jane's projects"],
  ["", "bob@example.com", "bob's projects"],
  ["  ", "bob@example.com", "bob's projects"],
])("derives a personal organization name from %j", (name, email, expected) => {
  expect(deriveOrgName(name, email)).toBe(expected);
});
