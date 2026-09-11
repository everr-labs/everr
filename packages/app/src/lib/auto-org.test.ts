import { describe, expect, it } from "vitest";
import {
  deriveOrgName,
  selectSoleOrganization,
  shouldCreateAutomaticOrganization,
} from "./auto-org";

describe("deriveOrgName", () => {
  it("uses the first name from user name", () => {
    expect(deriveOrgName("Jane Doe", "jane@example.com")).toBe(
      "Jane's projects",
    );
  });

  it("falls back to email local part when name is empty", () => {
    expect(deriveOrgName("", "bob@example.com")).toBe("bob's projects");
  });

  it("falls back to email local part when name is whitespace", () => {
    expect(deriveOrgName("  ", "bob@example.com")).toBe("bob's projects");
  });
});

describe("selectSoleOrganization", () => {
  it("selects the only membership", () => {
    expect(selectSoleOrganization(["org_1"])).toBe("org_1");
  });

  it("does not make an arbitrary selection among several memberships", () => {
    expect(selectSoleOrganization(["org_1", "org_2"])).toBeNull();
  });
});

describe("shouldCreateAutomaticOrganization", () => {
  it("creates only without memberships or pending invitations", () => {
    expect(
      shouldCreateAutomaticOrganization({
        membershipCount: 0,
        hasPendingInvitation: false,
      }),
    ).toBe(true);
    expect(
      shouldCreateAutomaticOrganization({
        membershipCount: 0,
        hasPendingInvitation: true,
      }),
    ).toBe(false);
    expect(
      shouldCreateAutomaticOrganization({
        membershipCount: 1,
        hasPendingInvitation: false,
      }),
    ).toBe(false);
  });
});
