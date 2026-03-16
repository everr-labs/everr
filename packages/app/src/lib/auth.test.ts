import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getTenantForOrganizationId: vi.fn(),
  getBearerToken: vi.fn(),
  validateAccessToken: vi.fn(),
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: mocked.getAuth,
}));

vi.mock("@/data/tenants", () => ({
  getTenantForOrganizationId: mocked.getTenantForOrganizationId,
}));

vi.mock("./access-token-auth", () => ({
  getBearerToken: mocked.getBearerToken,
  validateAccessToken: mocked.validateAccessToken,
}));

import { getAccessTokenSessionFromRequest, getWorkOSAuthSession } from "./auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAccessTokenSessionFromRequest", () => {
  it("returns null when the request does not include a bearer token", async () => {
    const request = new Request("http://localhost/test");
    mocked.getBearerToken.mockReturnValue(null);

    await expect(getAccessTokenSessionFromRequest(request)).resolves.toBeNull();

    expect(mocked.getBearerToken).toHaveBeenCalledWith(request.headers);
    expect(mocked.validateAccessToken).not.toHaveBeenCalled();
  });

  it("maps a validated access token into an Everr session", async () => {
    const request = new Request("http://localhost/test");
    mocked.getBearerToken.mockReturnValue("token_123");
    mocked.validateAccessToken.mockResolvedValue({
      tokenId: 9,
      tenantId: 42,
      organizationId: "org_123",
      userId: "user_123",
      name: "cli token",
    });

    await expect(getAccessTokenSessionFromRequest(request)).resolves.toEqual({
      tenantId: 42,
      organizationId: "org_123",
      userId: "user_123",
      sessionId: undefined,
    });
  });

  it("returns null when the bearer token is invalid", async () => {
    mocked.getBearerToken.mockReturnValue("token_123");
    mocked.validateAccessToken.mockResolvedValue(null);

    await expect(
      getAccessTokenSessionFromRequest(new Request("http://localhost/test")),
    ).resolves.toBeNull();
  });
});

describe("getWorkOSAuthSession", () => {
  it("returns null when WorkOS has no authenticated user", async () => {
    mocked.getAuth.mockResolvedValue({
      user: null,
      organizationId: "org_123",
      sessionId: "session_123",
    });

    await expect(getWorkOSAuthSession()).resolves.toBeNull();

    expect(console.error).toHaveBeenCalledWith("[auth] no user found");
    expect(mocked.getTenantForOrganizationId).not.toHaveBeenCalled();
  });

  it("returns null when WorkOS has no organization", async () => {
    mocked.getAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: null,
      sessionId: "session_123",
    });

    await expect(getWorkOSAuthSession()).resolves.toBeNull();

    expect(console.error).toHaveBeenCalledWith("[auth] no organization found");
    expect(mocked.getTenantForOrganizationId).not.toHaveBeenCalled();
  });

  it("returns null when no tenant mapping exists", async () => {
    mocked.getAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: "org_123",
      sessionId: "session_123",
    });
    mocked.getTenantForOrganizationId.mockResolvedValue(null);

    await expect(getWorkOSAuthSession()).resolves.toBeNull();

    expect(mocked.getTenantForOrganizationId).toHaveBeenCalledWith("org_123");
    expect(console.error).toHaveBeenCalledWith("[auth] no tenant found");
  });

  it("returns the WorkOS session when a tenant mapping exists", async () => {
    mocked.getAuth.mockResolvedValue({
      user: { id: "user_123" },
      organizationId: "org_123",
      sessionId: "session_123",
    });
    mocked.getTenantForOrganizationId.mockResolvedValue(42);

    await expect(getWorkOSAuthSession()).resolves.toEqual({
      tenantId: 42,
      organizationId: "org_123",
      userId: "user_123",
      sessionId: "session_123",
    });

    expect(console.error).not.toHaveBeenCalled();
  });
});
