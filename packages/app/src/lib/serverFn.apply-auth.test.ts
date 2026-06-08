import { describe, expect, it, vi } from "vitest";

// This test exercises the real buildApplyContext, so we unmock the module
// that test-setup.ts has replaced with a stub.
vi.unmock("@/lib/serverFn");

// buildApplyContext calls createClickhouseQuery(orgId); stub it so we don't
// touch the real clickhouse client.
vi.mock("./clickhouse", () => ({
  query: vi.fn(),
  createClickhouseQuery: (orgId: string) => ({ __org: orgId }),
}));
// serverFn.ts imports auth.server transitively; stub to avoid booting it.
vi.mock("@/lib/auth.server", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/data/dashboards/apply-auth", () => ({
  resolveApplyAuth: vi.fn(),
}));

import { buildApplyContext } from "./serverFn";

describe("buildApplyContext", () => {
  it("uses the API-key org when apiAuth is present", () => {
    const ctx = buildApplyContext(
      { organizationId: "org-k", principalId: "apikey:1" },
      null,
    );
    expect(ctx.session.session.activeOrganizationId).toBe("org-k");
    expect(ctx.session.user.id).toBe("apikey:1");
  });

  it("falls back to the session org when apiAuth is null", () => {
    const ctx = buildApplyContext(null, {
      session: { activeOrganizationId: "org-s" },
      user: { id: "u1" },
    } as never);
    expect(ctx.session.session.activeOrganizationId).toBe("org-s");
  });

  it("throws when there is no apiAuth and no session", () => {
    expect(() => buildApplyContext(null, null)).toThrow(/unauthenticated/i);
  });

  it("throws when the session has no active organization", () => {
    expect(() =>
      buildApplyContext(null, { session: {}, user: { id: "u1" } } as never),
    ).toThrow(/no active organization/i);
  });
});
