import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { auth } from "#app/lib/auth.server.ts";
import { getActiveOrganization, getOrganizations } from "./auth";

// getActiveOrganization reads request headers; the shared test-setup does not
// mock this subpath, so stub it here.
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => ({}),
}));

// These are vi.fn()s from the shared test-setup mock, but typed as better-auth
// endpoints — cast to Mock to drive them.
const getSession = auth.api.getSession as unknown as Mock;
const getFullOrganization = auth.api.getFullOrganization as unknown as Mock;

it("lists the authenticated user's organizations for device approval", async () => {
  vi.mocked(auth.api.listOrganizations).mockResolvedValue([
    {
      id: "org-a",
      name: "Org A",
      slug: "org-a",
      createdAt: new Date(),
    },
    {
      id: "org-b",
      name: "Org B",
      slug: "org-b",
      createdAt: new Date(),
    },
  ]);

  expect(await getOrganizations()).toEqual([
    { id: "org-a", name: "Org A" },
    { id: "org-b", name: "Org B" },
  ]);
  expect(auth.api.listOrganizations).toHaveBeenCalledWith({ headers: {} });
});

describe("getActiveOrganization (partial-auth server fn)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the org from the session's active organization (shared mock default)", async () => {
    // The shared partial-auth mock passes through auth.api.getSession(), whose
    // default has activeOrganizationId "test_org" — so the active-org path is
    // reachable without replacing the serverFn mock.
    getFullOrganization.mockResolvedValue({ id: "test_org", name: "Test Org" });

    const org = await getActiveOrganization();

    expect(getFullOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ query: { organizationId: "test_org" } }),
    );
    expect(org).toEqual({ id: "test_org", name: "Test Org" });
  });

  it("returns null when the session has no active organization", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "test_user" },
      session: { id: "test_session", activeOrganizationId: undefined },
    });

    const org = await getActiveOrganization();

    expect(org).toBeNull();
    expect(getFullOrganization).not.toHaveBeenCalled();
  });
});
