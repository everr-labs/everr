import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: vi.fn(),
  switchToOrganization: vi.fn(),
}));

vi.mock("@/lib/workos", () => ({
  getWorkOS: vi.fn(),
}));

import {
  getAuth,
  switchToOrganization,
} from "@workos/authkit-tanstack-react-start";
import { getWorkOS } from "@/lib/workos";
import {
  CreateOrganizationInputSchema,
  createOrganizationForCurrentUser,
} from "./onboarding";

const mockedGetAuth = vi.mocked(getAuth);
const mockedSwitchToOrganization = vi.mocked(switchToOrganization);
const mockedGetWorkOS = vi.mocked(getWorkOS);

const createOrganization = vi.fn();
const createOrganizationMembership = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  mockedGetWorkOS.mockReturnValue({
    organizations: {
      createOrganization,
    },
    userManagement: {
      createOrganizationMembership,
    },
  } as never);
});

describe("createOrganizationForCurrentUser", () => {
  it("rejects when user is not authenticated", async () => {
    mockedGetAuth.mockResolvedValue({ user: null } as never);

    await expect(
      createOrganizationForCurrentUser({ data: { organizationName: "Acme" } }),
    ).rejects.toThrow("You need to sign in before creating an organization.");

    expect(mockedGetWorkOS).not.toHaveBeenCalled();
  });

  it("does not create org when user already has an organization", async () => {
    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123", email: "user@example.com" },
      organizationId: "org_existing",
    } as never);

    await createOrganizationForCurrentUser({
      data: { organizationName: "Ignored Name" },
    });

    expect(mockedGetWorkOS).not.toHaveBeenCalled();
    expect(createOrganization).not.toHaveBeenCalled();
    expect(createOrganizationMembership).not.toHaveBeenCalled();
  });

  it("creates organization and admin membership for authenticated user", async () => {
    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123", email: "user@example.com" },
      organizationId: undefined,
    } as never);
    createOrganization.mockResolvedValue({ id: "org_new", name: "Acme" });
    createOrganizationMembership.mockResolvedValue({ id: "om_123" });

    await createOrganizationForCurrentUser({
      data: { organizationName: "Acme" },
    });

    expect(createOrganization).toHaveBeenCalledWith({ name: "Acme" });
    expect(createOrganizationMembership).toHaveBeenCalledWith({
      organizationId: "org_new",
      userId: "user_123",
      roleSlug: "admin",
    });
    expect(mockedSwitchToOrganization).toHaveBeenCalledWith({
      data: { organizationId: "org_new" },
    });
  });

  it("returns safe error when organization creation fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "11111111-1111-1111-1111-111111111111",
    );

    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123", email: "user@example.com" },
      organizationId: undefined,
    } as never);
    createOrganization.mockRejectedValue(new Error("workos down"));

    await expect(
      createOrganizationForCurrentUser({ data: { organizationName: "Acme" } }),
    ).rejects.toThrow(
      "We couldn't create your organization right now. Please try again. (ref: 11111111-1111-1111-1111-111111111111)",
    );

    expect(createOrganizationMembership).not.toHaveBeenCalled();
    expect(mockedSwitchToOrganization).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[onboarding] org_create_failed",
      expect.objectContaining({
        requestId: "11111111-1111-1111-1111-111111111111",
        userId: "user_123",
        organizationName: "Acme",
      }),
    );
  });

  it("returns safe error when membership creation fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "22222222-2222-2222-2222-222222222222",
    );

    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123", email: "user@example.com" },
      organizationId: undefined,
    } as never);
    createOrganization.mockResolvedValue({ id: "org_new" });
    createOrganizationMembership.mockRejectedValue(new Error("role missing"));

    await expect(
      createOrganizationForCurrentUser({ data: { organizationName: "Acme" } }),
    ).rejects.toThrow(
      "Your organization was created, but we couldn't finish setup. Please try again. (ref: 22222222-2222-2222-2222-222222222222)",
    );

    expect(mockedSwitchToOrganization).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[onboarding] membership_create_failed",
      expect.objectContaining({
        requestId: "22222222-2222-2222-2222-222222222222",
        userId: "user_123",
        organizationId: "org_new",
      }),
    );
  });

  it("returns safe error when session switch fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "33333333-3333-3333-3333-333333333333",
    );

    mockedGetAuth.mockResolvedValue({
      user: { id: "user_123", email: "user@example.com" },
      organizationId: undefined,
    } as never);
    createOrganization.mockResolvedValue({ id: "org_new" });
    createOrganizationMembership.mockResolvedValue({ id: "om_123" });
    mockedSwitchToOrganization.mockRejectedValue(new Error("cannot switch"));

    await expect(
      createOrganizationForCurrentUser({ data: { organizationName: "Acme" } }),
    ).rejects.toThrow(
      "Your organization was created, but we couldn't switch your session. Please try again. (ref: 33333333-3333-3333-3333-333333333333)",
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[onboarding] session_switch_failed",
      expect.objectContaining({
        requestId: "33333333-3333-3333-3333-333333333333",
        userId: "user_123",
        organizationId: "org_new",
      }),
    );
  });

  it("validates organization names with schema constraints", () => {
    expect(() =>
      CreateOrganizationInputSchema.parse({ organizationName: " " }),
    ).toThrow();
    expect(
      CreateOrganizationInputSchema.parse({ organizationName: "Acme Inc" }),
    ).toEqual({ organizationName: "Acme Inc" });
  });
});
