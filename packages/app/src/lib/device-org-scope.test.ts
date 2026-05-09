import { describe, expect, it } from "vitest";
import {
  getActiveOrganizationIdFromAuthSession,
  getDeviceOrgIdFromScope,
  withDeviceOrgScope,
} from "@/lib/device-org-scope";

describe("device org scope helpers", () => {
  it("adds the org marker while preserving existing scope values", () => {
    expect(withDeviceOrgScope("openid profile", "org_123")).toBe(
      "openid profile everr:org:org_123",
    );
  });

  it("replaces an existing org marker", () => {
    expect(withDeviceOrgScope("openid everr:org:old", "org_new")).toBe(
      "openid everr:org:org_new",
    );
  });

  it("reads the org marker from a scope string", () => {
    expect(getDeviceOrgIdFromScope("openid everr:org:org_123")).toBe("org_123");
  });

  it("returns null when no org marker is present", () => {
    expect(getDeviceOrgIdFromScope("openid profile")).toBeNull();
    expect(getDeviceOrgIdFromScope(null)).toBeNull();
  });

  it("reads the active organization from the browser auth session", () => {
    expect(
      getActiveOrganizationIdFromAuthSession({
        session: { activeOrganizationId: "org_current" },
      }),
    ).toBe("org_current");
  });

  it("returns null when the browser auth session has no active org", () => {
    expect(getActiveOrganizationIdFromAuthSession({ session: {} })).toBeNull();
    expect(getActiveOrganizationIdFromAuthSession(null)).toBeNull();
  });
});
