import { describe, expect, it } from "vitest";
import { CreateOrganizationInputSchema } from "@/common/organization-name";

describe("CreateOrganizationInputSchema", () => {
  it("rejects blank names", () => {
    expect(() =>
      CreateOrganizationInputSchema.parse({ organizationName: " " }),
    ).toThrow();
  });

  it("accepts valid names", () => {
    expect(
      CreateOrganizationInputSchema.parse({ organizationName: "Acme Inc" }),
    ).toEqual({ organizationName: "Acme Inc" });
  });
});
