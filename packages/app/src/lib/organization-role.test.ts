import { describe, expect, it } from "vitest";
import {
  hasOrganizationRole,
  isOrganizationAdmin,
  isOrganizationOwner,
} from "./organization-role";

describe("organization roles", () => {
  it("matches a role in a comma-separated role list", () => {
    expect(hasOrganizationRole("member, admin", ["admin"])).toBe(true);
    expect(isOrganizationAdmin("member, owner")).toBe(true);
    expect(isOrganizationOwner("member, owner")).toBe(true);
  });

  it("does not match partial or missing roles", () => {
    expect(isOrganizationAdmin("member")).toBe(false);
    expect(isOrganizationOwner("organization-owner")).toBe(false);
    expect(isOrganizationAdmin(undefined)).toBe(false);
  });
});
